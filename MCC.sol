// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Maryland Crab Coin (MCC)
 * - 6 decimals to match UI SCALE=1e6
 * - Simple Ownable + Minters
 * - ownerBurnFrom() so the MDUI contract (as owner) can do Recovery
 */
contract MarylandCrabCoin {
    string public name = "Maryland Crab Coin";
    string public symbol = "MCC";
    uint8  public constant decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public owner;
    mapping(address => bool) public minters;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MinterUpdated(address indexed account, bool allowed);

    modifier onlyOwner() {
        require(msg.sender == owner, "MCC: not owner");
        _;
    }
    modifier onlyMinter() {
        require(minters[msg.sender] || msg.sender == owner, "MCC: not minter");
        _;
    }

    constructor(address initialOwner) {
        require(initialOwner != address(0), "MCC: zero owner");
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    // --- ownership & minter control ---
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "MCC: zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
    function setMinter(address account, bool allowed) external onlyOwner {
        minters[account] = allowed;
        emit MinterUpdated(account, allowed);
    }

    // --- ERC20 core ---
    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "MCC: to zero");
        uint256 bal = balanceOf[from];
        require(bal >= amount, "MCC: balance");
        unchecked { balanceOf[from] = bal - amount; }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 alw = allowance[from][msg.sender];
        require(alw >= amount, "MCC: allowance");
        if (alw != type(uint256).max) {
            unchecked { allowance[from][msg.sender] = alw - amount; }
        }
        _transfer(from, to, amount);
        return true;
    }

    // --- mint/burn for MDUI + minters ---
    function mint(address to, uint256 amount) external onlyMinter {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    // Owner-only forced burn (used by MDUI for Recovery)
    function ownerBurnFrom(address from, uint256 amount) external onlyOwner {
        uint256 bal = balanceOf[from];
        require(amount > 0 && bal >= amount, "MCC: burn amount");
        unchecked { balanceOf[from] = bal - amount; }
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }
}
