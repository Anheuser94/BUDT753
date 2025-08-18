// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

// Minimal ERC20-like storage to demo recovery ops.
// In production, integrate into your MCC Treasury token.
contract MCCTreasuryRecovery {
    // --- Roles ---
    address public admin;
    mapping(address => bool) public isOps;

    modifier onlyOps() {
        require(isOps[msg.sender], "not ops");
        _;
    }

    // --- ERC20-like storage ---
    string public constant name = "Maryland Crab Coin";
    string public constant symbol = "MCC";
    uint8  public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    // --- Events ---
    event Transfer(address indexed from, address indexed to, uint256 value);
    event ForceBurn(address indexed from, uint256 amount, bytes32 caseRef);
    event RecoverAllToNewWallet(address indexed lostWallet, address indexed newWallet, uint256 amount, bytes32 caseRef);

    constructor() { admin = msg.sender; isOps[msg.sender] = true; }

    // (optional) admin helpers
    function grantOps(address a) external { require(msg.sender == admin, "not admin"); isOps[a] = true; }
    function revokeOps(address a) external { require(msg.sender == admin, "not admin"); isOps[a] = false; }

    // --- Internal mint/burn ---
    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "mint to zero");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
    function _burn(address from, uint256 amount) internal {
        require(from != address(0), "burn from zero");
        uint256 bal = balanceOf[from];
        require(bal >= amount, "insufficient");
        unchecked { balanceOf[from] = bal - amount; }
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    /// @notice Combined recovery operation:
    /// - Case A (force burn): set newWallet = address(0) and pass a positive `amount` to remove funds from `lostWallet`.
    /// - Case B (full-balance reissue): set `newWallet` to the replacement address and `amount` is ignored; the full
    ///   balance of `lostWallet` is burned and the same amount minted to `newWallet`.
    function recoverOrForceBurn(
        address lostWallet,
        address newWallet,   // address(0) => force burn mode; nonzero => full-balance reissue mode
        uint256 amount,      // used only in force burn mode
        bytes32 caseRef
    ) external onlyOps {
        require(lostWallet != address(0), "lost=0");
        if (newWallet == address(0)) {
            // --- Case A: Force burn specific amount from lost wallet ---
            require(amount > 0, "amount=0");
            _burn(lostWallet, amount);
            emit ForceBurn(lostWallet, amount, caseRef);
        } else {
            // --- Case B: Full-balance re-issue to new wallet ---
            require(newWallet != address(0), "new=0");
            uint256 bal = balanceOf[lostWallet];
            require(bal > 0, "no balance");
            _burn(lostWallet, bal);
            emit ForceBurn(lostWallet, bal, caseRef); // audit trail of removal
            _mint(newWallet, bal);
            emit RecoverAllToNewWallet(lostWallet, newWallet, bal, caseRef);
        }
    }
}
