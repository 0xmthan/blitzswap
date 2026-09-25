// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title BlitzToken
/// @notice A testnet ERC-20 with a public faucet so anyone can get tokens to swap.
contract BlitzToken is ERC20 {
    /// @notice How many tokens one faucet call hands out (in whole tokens).
    uint256 public constant FAUCET_AMOUNT = 1_000;

    /// @notice How long an address must wait between faucet calls.
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    /// @notice Last time each address used the faucet (unix seconds).
    mapping(address => uint256) public lastFaucetAt;

    error FaucetCooldown(uint256 availableAt);

    constructor(string memory name_, string memory symbol_, uint256 initialSupply)
        ERC20(name_, symbol_)
    {
        _mint(msg.sender, initialSupply * 10 ** decimals());
    }

    /// @notice Mint FAUCET_AMOUNT tokens to the caller, at most once per cooldown.
    function faucet() external {
        uint256 last = lastFaucetAt[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) {
            revert FaucetCooldown(last + FAUCET_COOLDOWN);
        }
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT * 10 ** decimals());
    }
}
