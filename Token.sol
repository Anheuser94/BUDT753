// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.22;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MarylandCrabCoin is ERC20, ERC20Permit, Ownable {
    constructor(address initialOwner)
        ERC20("Maryland Crab Coin", "MCC")
        ERC20Permit("Maryland Crab Coin")
        Ownable(initialOwner)
    {
    }

function mintForTesting(address to, uint256 amount) external {
    _mint(to, amount);
}

}