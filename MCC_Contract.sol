
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/***************************
 *  PART 0: Token interface
 ***************************/
interface IMCC6 {
    function balanceOf(address) external view returns (uint256);
    function decimals() external view returns (uint8);
    function setMinter(address account, bool allowed) external;
    function mint(address to, uint256 amount) external;
    function ownerBurnFrom(address from, uint256 amount) external;
}

/***************************
 *  PART 1: Citizen logic  *
 ***************************/
contract SimpleWeeklyCheckIn {
    // flags
    uint16 public constant FLAG_ATTENDED_SCHOOL          = 1 << 0;
    uint16 public constant FLAG_COMMISSION_THIS_WEEK     = 1 << 1;
    uint16 public constant FLAG_NEW_PENSION_REPORTED     = 1 << 2;
    uint16 public constant FLAG_AVAILABILITY_RESTRICTION = 1 << 3;
    uint16 public constant FLAG_JOB_SEARCH_ISSUE         = 1 << 4;
    uint16 public constant FLAG_OTHER_REVIEW             = 1 << 5;

    uint16 private constant ALLOWED_FLAGS_MASK =
        FLAG_ATTENDED_SCHOOL |
        FLAG_COMMISSION_THIS_WEEK |
        FLAG_NEW_PENSION_REPORTED |
        FLAG_AVAILABILITY_RESTRICTION |
        FLAG_JOB_SEARCH_ISSUE |
        FLAG_OTHER_REVIEW;

    // MD math params
    uint256 public constant SCALE         = 1e6;
    uint256 public constant DEP_ALLOW_PER = 8 * SCALE;
    uint8   public constant MAX_DEP       = 5;

    mapping(address => uint8) public dependents;

    enum CertStatus { NotSubmitted, Submitted }

    struct CalcInputs {
        uint256 reportedEarnings;
        bool    availableForWork;
        bool    jobSearchCompliant;
        bool    workedFullTime;
    }

    struct Certification {
        address    claimant;
        uint256    weekId;
        bytes32    answersHash;
        bytes32    accountRef;
        uint16     flags;
        CalcInputs inputs;
        CertStatus status;
        uint64     submittedAt;
    }

    Certification[] public certifications;

    // (claimant, weekId) -> certId+1
    mapping(bytes32 => uint256) private idByKey;
    // accountRef -> certId+1 (for UI fallbacks)
    mapping(bytes32 => uint256) private idByRef;

    // demo-only policy knobs
    mapping(address => uint256) public baseWeeklyBenefit; // scaled
    uint256 public disregard;       // scaled
    uint16  public taperBps;        // kept for ABI compat (unused in MD)
    uint256 public maxWeeklyPayout; // scaled

    event CertificationSubmitted(
        uint256 indexed certId,
        address indexed claimant,
        uint256 indexed weekId,
        bytes32 answersHash,
        bytes32 accountRef,
        uint256 reportedEarnings,
        bool    availableForWork,
        bool    jobSearchCompliant,
        bool    workedFullTime,
        uint16  flags
    );

    function submitCertification(
        uint256 weekId,
        bytes32 answersHash,
        bytes32 accountRef,
        uint256 reportedEarnings,
        bool    availableForWork,
        bool    jobSearchCompliant,
        bool    workedFullTime,
        uint16  flags
    ) external returns (uint256 certId) {
        require(weekId != 0, "weekId required");
        require(answersHash != bytes32(0), "answersHash required");
        require(accountRef != bytes32(0), "accountRef required");
        require((flags & ~ALLOWED_FLAGS_MASK) == 0, "unknown flags set");

        bytes32 key = keccak256(abi.encodePacked(msg.sender, weekId));
        require(idByKey[key] == 0, "Already submitted");

        certifications.push(Certification({
            claimant: msg.sender,
            weekId: weekId,
            answersHash: answersHash,
            accountRef: accountRef,
            flags: flags,
            inputs: CalcInputs({
                reportedEarnings: reportedEarnings,
                availableForWork: availableForWork,
                jobSearchCompliant: jobSearchCompliant,
                workedFullTime: workedFullTime
            }),
            status: CertStatus.Submitted,
            submittedAt: uint64(block.timestamp)
        }));

        certId = certifications.length - 1;
        idByKey[key] = certId + 1;
        idByRef[accountRef] = certId + 1;

        emit CertificationSubmitted(
            certId,
            msg.sender,
            weekId,
            answersHash,
            accountRef,
            reportedEarnings,
            availableForWork,
            jobSearchCompliant,
            workedFullTime,
            flags
        );
    }

    // MD-accurate preview (read-only)
    function previewPayout(
        address claimant,
        uint256 reportedEarnings,
        bool availableForWork,
        bool jobSearchCompliant,
        bool workedFullTime
    ) external view returns (uint256) {
        if (!availableForWork || !jobSearchCompliant || workedFullTime) return 0;

        uint256 wba = baseWeeklyBenefit[claimant];
        if (wba == 0) return 0;

        uint8 dep = dependents[claimant];
        if (dep > MAX_DEP) dep = MAX_DEP;
        uint256 allowance = uint256(dep) * DEP_ALLOW_PER;

        uint256 basePlusDA = wba + allowance;
        if (basePlusDA > maxWeeklyPayout) basePlusDA = maxWeeklyPayout;

        uint256 countable = reportedEarnings > disregard ? (reportedEarnings - disregard) : 0;
        uint256 payableAmt = basePlusDA > countable ? (basePlusDA - countable) : 0;

        payableAmt = (payableAmt / SCALE) * SCALE;
        return payableAmt;
    }

    // tiny getters
    function getCertification(uint256 certId) external view returns (Certification memory) {
        require(certId < certifications.length, "bad certId");
        return certifications[certId];
    }

    // IMPORTANT: return only a single uint256 (UI expects this)
    function getCertificationId(address claimant, uint256 weekId) external view returns (uint256) {
        uint256 stored = idByKey[keccak256(abi.encodePacked(claimant, weekId))];
        return stored == 0 ? 0 : stored - 1;
    }

    function getCertificationIdByRef(bytes32 ref) external view returns (uint256) {
        uint256 stored = idByRef[ref];
        return stored == 0 ? 0 : stored - 1;
    }

    // alias for UI fallback names
    function getCertificationIdByAccountRef(bytes32 ref) external view returns (uint256) {
        uint256 stored = idByRef[ref];
        return stored == 0 ? 0 : stored - 1;
    }
    function certificationIdByAccountRef(bytes32 ref) external view returns (uint256) {
        uint256 stored = idByRef[ref];
        return stored == 0 ? 0 : stored - 1;
    }

    function getCertificationCount() external view returns (uint256) {
        return certifications.length;
    }

    // demo seeders (ABI kept as-is for your UI buttons)
    function testSetBaseWeeklyBenefit(address claimant, uint256 amount) external {
        baseWeeklyBenefit[claimant] = amount;
    }
    function testSetPolicy(uint256 _disregard, uint16 _taperBps, uint256 _maxWeeklyPayout) external {
        disregard       = _disregard;
        taperBps        = _taperBps;      // kept for compatibility (unused in MD)
        maxWeeklyPayout = _maxWeeklyPayout;
    }
    function testSetDependents(address claimant, uint8 depCount) external {
        require(depCount <= MAX_DEP, "max 5");
        dependents[claimant] = depCount;
    }
}

/*******************************************
 *  PART 2: Processor + Recovery add-on    *
 *******************************************/
contract MDUIProcessorAlignedExternal is SimpleWeeklyCheckIn {
    // roles
    address public owner;
    mapping(address => bool) public processor;

    // external token (public to expose token() getter for UI)
    IMCC6 public token;

    enum ProcStatus { None, Approved, Rejected, Paid }
    struct ProcRecord { ProcStatus status; uint256 lockedAmount; uint64 decidedAt; string rejectReason; }
    mapping(uint256 => ProcRecord) public procByCertId;

    bool private _entered;

    event ProcessorUpdated(address indexed account, bool allowed);
    event ProcApproved(uint256 indexed certId, address indexed by, uint256 amount);
    event ProcRejected(uint256 indexed certId, address indexed by, string reason);
    event ProcPaid(uint256 indexed certId, address indexed to, uint256 amount);
    event TokensReissued(address indexed oldWallet, address indexed newWallet, uint256 amount);
    event TokenAddressUpdated(address indexed oldToken, address indexed newToken);

    modifier onlyOwner() { require(msg.sender == owner, "MDUI: not owner"); _; }
    modifier onlyProcessor() { require(processor[msg.sender], "MDUI: not processor"); _; }
    modifier nonReentrant() { require(!_entered, "MDUI: reentrancy"); _entered = true; _; _entered = false; }

    constructor(address tokenAddress_) {
        owner = msg.sender;
        require(tokenAddress_ != address(0), "MDUI: token required");
        token = IMCC6(tokenAddress_);
    }

    // optional: allow owner to swap token if needed later (not used by UI)
    function setToken(address tokenAddress_) external onlyOwner {
        require(tokenAddress_ != address(0), "MDUI: token required");
        address old = address(token);
        token = IMCC6(tokenAddress_);
        emit TokenAddressUpdated(old, tokenAddress_);
    }

    // admin
    function setProcessor(address account, bool allowed) external onlyOwner {
        processor[account] = allowed;
        emit ProcessorUpdated(account, allowed);
    }

    // preview (processor-only)
    function previewCertification(uint256 certId)
        external
        view
        onlyProcessor
        returns (Certification memory cert, uint256 computedAmount, ProcRecord memory proc)
    {
        require(certId < certifications.length, "bad certId");
        cert = certifications[certId];
        computedAmount = this.previewPayout(
            cert.claimant,
            cert.inputs.reportedEarnings,
            cert.inputs.availableForWork,
            cert.inputs.jobSearchCompliant,
            cert.inputs.workedFullTime
        );
        proc = procByCertId[certId];
    }

    // approve (lock)
    function approveCertification(uint256 certId) public onlyProcessor {
        require(certId < certifications.length, "bad certId");
        Certification storage c = certifications[certId];
        require(c.status == CertStatus.Submitted, "not submitted");
        ProcRecord storage pr = procByCertId[certId];
        require(pr.status == ProcStatus.None, "already decided");

        uint256 amt = this.previewPayout(
            c.claimant,
            c.inputs.reportedEarnings,
            c.inputs.availableForWork,
            c.inputs.jobSearchCompliant,
            c.inputs.workedFullTime
        );
        pr.lockedAmount = amt;
        pr.status = ProcStatus.Approved;
        pr.decidedAt = uint64(block.timestamp);
        pr.rejectReason = "";
        emit ProcApproved(certId, msg.sender, amt);
    }

    // pay (mint to claimant)
    function payApproved(uint256 certId) public onlyProcessor nonReentrant {
        require(certId < certifications.length, "bad certId");
        Certification storage c = certifications[certId];
        ProcRecord storage pr = procByCertId[certId];
        require(pr.status == ProcStatus.Approved, "not approved");
        require(pr.lockedAmount > 0, "zero amount");
        token.mint(c.claimant, pr.lockedAmount);
        pr.status = ProcStatus.Paid;
        pr.decidedAt = uint64(block.timestamp);
        emit ProcPaid(certId, c.claimant, pr.lockedAmount);
    }

    // reject
    function rejectCertification(uint256 certId, string calldata reason) external onlyProcessor {
        require(certId < certifications.length, "bad certId");
        Certification storage c = certifications[certId];
        require(c.status == CertStatus.Submitted, "not submitted");
        ProcRecord storage pr = procByCertId[certId];
        require(pr.status == ProcStatus.None || pr.status == ProcStatus.Approved, "finalized");
        pr.status = ProcStatus.Rejected;
        pr.lockedAmount = 0;
        pr.decidedAt = uint64(block.timestamp);
        pr.rejectReason = reason;
        emit ProcRejected(certId, msg.sender, reason);
    }

    // combined approve+pay (as your UI uses)
    function approveAndPay(uint256 certId) external onlyProcessor nonReentrant {
        require(certId < certifications.length, "bad certId");
        Certification storage c = certifications[certId];
        require(c.status == CertStatus.Submitted, "not submitted");
        ProcRecord storage pr = procByCertId[certId];
        require(pr.status == ProcStatus.None, "already decided");

        uint256 amt = this.previewPayout(
            c.claimant,
            c.inputs.reportedEarnings,
            c.inputs.availableForWork,
            c.inputs.jobSearchCompliant,
            c.inputs.workedFullTime
        );
        require(amt > 0, "zero amount");

        pr.lockedAmount = amt;
        emit ProcApproved(certId, msg.sender, amt);

        token.mint(c.claimant, amt);
        pr.status = ProcStatus.Paid;
        pr.decidedAt = uint64(block.timestamp);
        emit ProcPaid(certId, c.claimant, amt);
    }

    // Recovery: burn ALL from old and reissue to new (owner-only)
    function adminBurnAndReissueAll(address oldWallet, address newWallet) external onlyOwner nonReentrant {
        require(oldWallet != address(0) && newWallet != address(0), "zero addr");
        require(oldWallet != newWallet, "same wallets");
        uint256 amt = token.balanceOf(oldWallet);
        require(amt > 0, "no balance");
        token.ownerBurnFrom(oldWallet, amt);
        token.mint(newWallet, amt);
        emit TokensReissued(oldWallet, newWallet, amt);
    }
}

      
   
