// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AnchorRegistry
 * @notice Antaria's on-chain anchor for tanda lifecycle events.
 *         Stores no heavy data — only emits events with hashes
 *         that can be verified against the off-chain ledger.
 */
contract AnchorRegistry {
    address public owner;
    uint256 public anchorCount;

    event Anchored(
        bytes32 indexed groupId,
        string  anchorType,
        bytes32 refId,
        bytes32 dataHash,
        uint256 timestamp
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Anchor a batch hash for a tanda event on-chain.
     * @param groupId   keccak256(tandaId + salt) — privacy-safe group ID
     * @param anchorType Event type: TANDA_CREATED, TANDA_ACTIVATED, COVERAGE_ACTIVATED,
     *                   USER_REPLACED, TANDA_CLOSED, RAFFLE_RESULT, INITIAL_FUND_COMPLETED
     * @param refId     Batch/period identifier
     * @param dataHash  keccak256 of the batch data from the off-chain ledger
     */
    function anchor(
        bytes32 groupId,
        string calldata anchorType,
        bytes32 refId,
        bytes32 dataHash
    ) external onlyOwner {
        emit Anchored(groupId, anchorType, refId, dataHash, block.timestamp);
        anchorCount++;
    }
}
