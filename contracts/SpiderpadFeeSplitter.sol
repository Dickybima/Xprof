// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IPonsFeeEscrow {
    function balanceOf(address recipient) external view returns (uint256);
    function claim() external returns (uint256);
}

/// @title SPIDERPAD fee splitter
/// @notice Set as a coin's Pons creator fee recipient. Fees credited to it in
/// the Pons escrow are split evenly between the coin's launcher and the
/// SPIDERPAD vault. Anyone may trigger a payout; the recipients are fixed at
/// deployment and nothing here can redirect them.
contract SpiderpadFeeSplitter {
    address public immutable creator;
    address public immutable vault;
    IPonsFeeEscrow public immutable escrow;

    bool private locked;

    event Distributed(uint256 creatorAmount, uint256 vaultAmount);

    error ZeroAddress();
    error Reentrancy();
    error TransferFailed(address to);

    constructor(address creator_, address vault_, IPonsFeeEscrow escrow_) {
        if (creator_ == address(0) || vault_ == address(0) || address(escrow_) == address(0)) revert ZeroAddress();
        creator = creator_;
        vault = vault_;
        escrow = escrow_;
    }

    receive() external payable {}

    /// @notice Pulls this splitter's balance out of the Pons escrow and pays
    /// half to the creator and half to the vault (the odd wei goes to the
    /// creator).
    function claim() external returns (uint256 creatorAmount, uint256 vaultAmount) {
        if (locked) revert Reentrancy();
        locked = true;

        if (escrow.balanceOf(address(this)) != 0) escrow.claim();

        uint256 total = address(this).balance;
        vaultAmount = total / 2;
        creatorAmount = total - vaultAmount;
        if (vaultAmount != 0) _send(vault, vaultAmount);
        if (creatorAmount != 0) _send(creator, creatorAmount);

        locked = false;
        emit Distributed(creatorAmount, vaultAmount);
    }

    /// @notice What claim() would pay out right now, before any split.
    function claimable() external view returns (uint256) {
        return escrow.balanceOf(address(this)) + address(this).balance;
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed(to);
    }
}
