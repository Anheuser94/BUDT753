// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/***************************
 *  PART 1: Citizen logic  *
 ***************************/
/**
 * SimpleWeeklyCheckIn (Maryland-accurate preview)
 * ------------------------------------------------
 * Unmodified from your reference (minor style only) so processor
 * functions below align 1:1 with data layout and SCALE=1e6 math.
 */
contract SimpleWeeklyCheckIn {
    // ---- small review flags (bitmask) so processors can triage quickly ----
    uint16 public constant FLAG_ATTENDED_SCHOOL          = 1 << 0; // Q2 = YES
    uint16 public constant FLAG_COMMISSION_THIS_WEEK     = 1 << 1; // Q5 = YES
    uint16 public constant FLAG_NEW_PENSION_REPORTED     = 1 << 2; // Q6 = YES
    uint16 public constant FLAG_AVAILABILITY_RESTRICTION = 1 << 3; // Q1 = NO/limited
    uint16 public constant FLAG_JOB_SEARCH_ISSUE         = 1 << 4; // Q3 = NO
    uint16 public constant FLAG_OTHER_REVIEW             = 1 << 5; // catch-all

    uint16 private constant ALLOWED_FLAGS_MASK =
        FLAG_ATTENDED_SCHOOL |
        FLAG_COMMISSION_THIS_WEEK |
        FLAG_NEW_PENSION_REPORTED |
        FLAG_AVAILABILITY_RESTRICTION |
        FLAG_JOB_SEARCH_ISSUE |
        FLAG_OTHER_REVIEW;

    // ---- Maryland preview math parameters (demo scale = 6 decimals, e.g., $1.00 = 1_000_000) ----
    uint256 public constant SCALE         = 1e6;           // $1.00 in demo math
    uint256 public constant DEP_ALLOW_PER = 8 * SCALE;     // $8 per dependent (added to WBA)
    uint8   public constant MAX_DEP       = 5;             // up to five dependents for allowance

    // Dependents per claimant (set once per demo; in production this is fixed at benefit-year start)
    mapping(address => uint8) public dependents;

    // ---- storage for weekly submissions ----
    enum CertStatus { NotSubmitted, Submitted }

    struct CalcInputs {
        uint256 reportedEarnings;   // gross earnings this week (scaled by 1e6)
        bool    availableForWork;   // Q1
        bool    jobSearchCompliant; // Q3
        bool    workedFullTime;     // from Q4 (usually disqualifies)
    }

    struct Certification {
        address    claimant;
        uint256    weekId;          // e.g., 202534 (Year 2025, Week 34)
        bytes32    answersHash;     // fingerprint (hash) of the 7 answers
        bytes32    accountRef;      // HASH(accountNumber + salt + weekId) — never raw account #
        uint16     flags;           // review flags bitmask
        CalcInputs inputs;          // tiny set of items needed by the calculator later
        CertStatus status;          // Submitted
        uint64     submittedAt;     // timestamp
    }

    Certification[] public certifications;
    mapping(bytes32 => uint256) private idByKey; // (claimant,weekId) -> certId+1 (0 = none)

    // --- demo-only policy knobs used by previewPayout ---
    mapping(address => uint256) public baseWeeklyBenefit; // per-claimant WBA (scaled)
    uint256 public disregard;       // first $X of weekly earnings ignored (scaled). MD: $50.
    uint16  public taperBps;        // kept for compatibility; NOT used in MD-accurate mode
    uint256 public maxWeeklyPayout; // schedule maximum (scaled). MD max WBA currently $430.

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

    // -------- MAIN #1: submit weekly check-in --------
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

        // 1 submission per (citizen, week)
        bytes32 key = keccak256(abi.encodePacked(msg.sender, weekId));
        require(idByKey[key] == 0, "Already submitted for this week");

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

    // -------- MAIN #2: preview estimated payout (Maryland-accurate; read-only) --------
    function previewPayout(
        address claimant,
        uint256 reportedEarnings,
        bool availableForWork,
        bool jobSearchCompliant,
        bool workedFullTime
    ) external view returns (uint256) {
        // Eligibility gates (simplified weekly checks)
        if (!availableForWork || !jobSearchCompliant || workedFullTime) return 0;

        // Weekly Benefit Amount (WBA) from schedule (seed via testSetBaseWeeklyBenefit for demo)
        uint256 wba = baseWeeklyBenefit[claimant];
        if (wba == 0) return 0;

        // Dependents' allowance: $8 per dependent, max five
        uint8 dep = dependents[claimant];
        if (dep > MAX_DEP) dep = MAX_DEP;
        uint256 allowance = uint256(dep) * DEP_ALLOW_PER;

        // Base + allowance, capped at schedule maximum (e.g., $430)
        uint256 basePlusDA = wba + allowance;
        if (basePlusDA > maxWeeklyPayout) {
            basePlusDA = maxWeeklyPayout;
        }

        // Partial benefit: $50 disregard, then dollar-for-dollar reduction
        uint256 countable = reportedEarnings > disregard ? (reportedEarnings - disregard) : 0;
        uint256 payableAmt = basePlusDA > countable ? (basePlusDA - countable) : 0;

        // Round down to whole dollars (with SCALE = 1e6)
        payableAmt = (payableAmt / SCALE) * SCALE;
        return payableAmt;
    }

    // ---- tiny getters (free reads) ----
    function getCertification(uint256 certId) external view returns (Certification memory) {
        require(certId < certifications.length, "bad certId");
        return certifications[certId];
    }

    function getCertificationId(address claimant, uint256 weekId) external view returns (bool, uint256) {
        uint256 stored = idByKey[keccak256(abi.encodePacked(claimant, weekId))];
        return (stored != 0, stored == 0 ? 0 : stored - 1);
    }

    function getCertificationCount() external view returns (uint256) {
        return certifications.length;
    }

    // ---- demo-only setters (no access control for classroom/testnet) ----
    function testSetBaseWeeklyBenefit(address claimant, uint256 amount) external { baseWeeklyBenefit[claimant] = amount; }
    function testSetPolicy(uint256 _disregard, uint16 _taperBps, uint256 _maxWeeklyPayout) external {
        disregard       = _disregard;
        taperBps        = _taperBps;      // kept, not used by MD preview
        maxWeeklyPayout = _maxWeeklyPayout;
    }
    function testSetDependents(address claimant, uint8 depCount) external {
        require(depCount <= MAX_DEP, "max 5"); dependents[claimant] = depCount; }
}

/********************************
 *  PART 2: Token used for pay  *
 ********************************/
// Minimal ERC20 with 6 decimals (to match SCALE=1e6);
// contract-owned so we can do an owner-only burn for recovery.
contract MCC6 {
    string public name = "Maryland Claims Credit";
    string public symbol = "MCC";
    uint8  public decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public owner;                 // set to the MDUI contract address
    mapping(address => bool) public minters;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event MinterUpdated(address indexed account, bool allowed);

    modifier onlyOwner() { require(msg.sender == owner, "MCC: not owner"); _; }
    modifier onlyMinter() { require(minters[msg.sender] || msg.sender == owner, "MCC: not minter"); _; }

    constructor(address _owner) { owner = _owner; }

    function setMinter(address account, bool allowed) external onlyOwner { minters[account] = allowed; emit MinterUpdated(account, allowed); }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "MCC: to zero");
        uint256 bal = balanceOf[from];
        require(bal >= amount, "MCC: balance");
        unchecked { balanceOf[from] = bal - amount; }
        balanceOf[to] += amount; emit Transfer(from, to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) { _transfer(msg.sender, to, amount); return true; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; emit Approval(msg.sender, spender, amount); return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 alw = allowance[from][msg.sender]; require(alw >= amount, "MCC: allowance");
        if (alw != type(uint256).max) { unchecked { allowance[from][msg.sender] = alw - amount; } }
        _transfer(from, to, amount); return true; }

    function mint(address to, uint256 amount) external onlyMinter { totalSupply += amount; balanceOf[to] += amount; emit Transfer(address(0), to, amount); }

    // Owner-only forced burn (used for recovery)
    function ownerBurnFrom(address from, uint256 amount) external onlyOwner {
        uint256 bal = balanceOf[from]; require(amount > 0 && bal >= amount, "MCC: burn amount");
        unchecked { balanceOf[from] = bal - amount; }
        totalSupply -= amount; emit Transfer(from, address(0), amount);
    }
}

/*******************************************
 *  PART 3: Processor + Recovery add-on    *
 *******************************************/
contract MDUIProcessorAligned is SimpleWeeklyCheckIn {
    // --- roles & token ---
    address public owner;
    mapping(address => bool) public processor;

    MCC6 public token; // 6-decimals token aligned to SCALE

    // --- processor status ---
    enum ProcStatus { None, Approved, Rejected, Paid }
    struct ProcRecord { ProcStatus status; uint256 lockedAmount; uint64 decidedAt; string rejectReason; }
    mapping(uint256 => ProcRecord) public procByCertId; // certId => processor-side record

    // reentrancy guard
    bool private _entered;

    // events
    event ProcessorUpdated(address indexed account, bool allowed);
    event ProcApproved(uint256 indexed certId, address indexed by, uint256 amount);
    event ProcRejected(uint256 indexed certId, address indexed by, string reason);
    event ProcPaid(uint256 indexed certId, address indexed to, uint256 amount);
    event TokensReissued(address indexed oldWallet, address indexed newWallet, uint256 amount);

    modifier onlyOwner() { require(msg.sender == owner, "MDUI: not owner"); _; }
    modifier onlyProcessor() { require(processor[msg.sender], "MDUI: not processor"); _; }
    modifier nonReentrant() { require(!_entered, "MDUI: reentrancy"); _entered = true; _; _entered = false; }

    constructor() {
        owner = msg.sender;
        token = new MCC6(address(this)); // this contract owns token (allows ownerBurnFrom)
        token.setMinter(address(this), true);
    }

    // --- admin ---
    function setProcessor(address account, bool allowed) external onlyOwner { processor[account] = allowed; emit ProcessorUpdated(account, allowed); }

    // --- VIEW: preview claimant + computed estimate (small return set to avoid stack-too-deep) ---
    function previewCertification(uint256 certId) external view onlyProcessor returns (Certification memory cert, uint256 computedAmount, ProcRecord memory proc) {
        require(certId < certifications.length, "bad certId");
        cert = certifications[certId];
        computedAmount = this.previewPayout(cert.claimant, cert.inputs.reportedEarnings, cert.inputs.availableForWork, cert.inputs.jobSearchCompliant, cert.inputs.workedFullTime);
        proc = procByCertId[certId];
    }

    // --- APPROVE (lock) ---
    function approveCertification(uint256 certId) public onlyProcessor {
        require(certId < certifications.length, "bad certId");
        Certification storage c = certifications[certId];
        require(c.status == CertStatus.Submitted, "not submitted");
        ProcRecord storage pr = procByCertId[certId];
        require(pr.status == ProcStatus.None, "already decided");

        uint256 amt = this.previewPayout(c.claimant, c.inputs.reportedEarnings, c.inputs.availableForWork, c.inputs.jobSearchCompliant, c.inputs.workedFullTime);
        pr.lockedAmount = amt; pr.status = ProcStatus.Approved; pr.decidedAt = uint64(block.timestamp); pr.rejectReason = "";
        emit ProcApproved(certId, msg.sender, amt);
    }

    // --- PAY (mint to claimant) ---
    function payApproved(uint256 certId) public onlyProcessor nonReentrant {
        require(certId < certifications.length, "bad certId");
        Certification storage c = certifications[certId];
        ProcRecord storage pr = procByCertId[certId];
        require(pr.status == ProcStatus.Approved, "not approved");
        require(pr.lockedAmount > 0, "zero amount");
        token.mint(c.claimant, pr.lockedAmount);
        pr.status = ProcStatus.Paid; pr.decidedAt = uint64(block.timestamp);
        emit ProcPaid(certId, c.claimant, pr.lockedAmount);
    }

    // --- REJECT (store reason) ---
    function rejectCertification(uint256 certId, string calldata reason) external onlyProcessor {
        require(certId < certifications.length, "bad certId");
        Certification storage c = certifications[certId];
        require(c.status == CertStatus.Submitted, "not submitted");
        ProcRecord storage pr = procByCertId[certId];
        require(pr.status == ProcStatus.None || pr.status == ProcStatus.Approved, "finalized");
        pr.status = ProcStatus.Rejected; pr.lockedAmount = 0; pr.decidedAt = uint64(block.timestamp); pr.rejectReason = reason;
        emit ProcRejected(certId, msg.sender, reason);
    }

    // --- COMBINED: APPROVE + PAY in one tx (as requested) ---
    function approveAndPay(uint256 certId) external onlyProcessor nonReentrant {
        require(certId < certifications.length, "bad certId");
        Certification storage c = certifications[certId];
        require(c.status == CertStatus.Submitted, "not submitted");
        ProcRecord storage pr = procByCertId[certId];
        require(pr.status == ProcStatus.None, "already decided");
        uint256 amt = this.previewPayout(c.claimant, c.inputs.reportedEarnings, c.inputs.availableForWork, c.inputs.jobSearchCompliant, c.inputs.workedFullTime);
        require(amt > 0, "zero amount");
        pr.lockedAmount = amt; emit ProcApproved(certId, msg.sender, amt);
        token.mint(c.claimant, amt);
        pr.status = ProcStatus.Paid; pr.decidedAt = uint64(block.timestamp);
        emit ProcPaid(certId, c.claimant, amt);
    }

    // --- RECOVERY: burn ALL from old wallet and reissue to new wallet ---
    function adminBurnAndReissueAll(address oldWallet, address newWallet) external onlyOwner nonReentrant {
        require(oldWallet != address(0) && newWallet != address(0), "zero addr");
        require(oldWallet != newWallet, "same wallets");
        uint256 amt = token.balanceOf(oldWallet); require(amt > 0, "no balance");
        token.ownerBurnFrom(oldWallet, amt);
        token.mint(newWallet, amt);
        emit TokensReissued(oldWallet, newWallet, amt);
    }
}

