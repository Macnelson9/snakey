// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title GameRewards
/// @notice Holds the G$ reward pool and releases it against EIP-712 vouchers
///         signed by the off-chain scorer. The scorer authoritatively replays a
///         run (seed + input log) on the shared deterministic engine and only
///         then signs `{player, runId, amount, deadline}`. This contract is the
///         on-chain "bank + notary": it never sees a move, only a signed payout.
///
/// @dev Defense in depth around the crown-jewel scorer key:
///      - `consumed[runId]` makes every voucher single-use (replay guard).
///      - `deadline` bounds a voucher's validity window.
///      - a per-epoch payout cap means a leaked key can drain at most one epoch's
///        worth before the owner rotates `scorer` — pair with off-chain rotation.
///      The EIP-712 domain (name "GameRewards", version "1") and the Voucher type
///      MUST stay byte-for-byte in sync with apps/web/src/lib/voucher.ts.
contract GameRewards is EIP712, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Voucher {
        address player;
        bytes32 runId;
        uint256 amount;
        uint256 deadline;
    }

    /// @dev keccak256 of the Voucher struct signature — identical to voucher.ts.
    bytes32 public constant VOUCHER_TYPEHASH =
        keccak256("Voucher(address player,bytes32 runId,uint256 amount,uint256 deadline)");

    /// @notice The G$ token paid out to players.
    IERC20 public immutable gd;

    /// @notice Trusted off-chain scorer whose signature authorizes payouts.
    address public scorer;

    /// @notice Epoch length in seconds; epochs partition the per-epoch cap.
    uint256 public immutable epochLength;

    /// @notice Maximum G$ that may be paid out within a single epoch.
    uint256 public epochCap;

    /// @notice runId => whether a voucher for it has already been redeemed.
    mapping(bytes32 => bool) public consumed;

    /// @notice epoch index => G$ paid out so far in that epoch.
    mapping(uint256 => uint256) public epochSpent;

    event Redeemed(
        address indexed player, bytes32 indexed runId, uint256 amount, uint256 indexed epoch
    );
    event ScorerRotated(address indexed previousScorer, address indexed newScorer);
    event EpochCapUpdated(uint256 previousCap, uint256 newCap);
    event Withdrawn(address indexed to, uint256 amount);

    error ZeroAddress();
    error ZeroEpochLength();
    error ZeroAmount();
    error VoucherExpired();
    error VoucherAlreadyConsumed();
    error BadSignature();
    error EpochCapExceeded();

    constructor(
        IERC20 _gd,
        address _scorer,
        uint256 _epochLength,
        uint256 _epochCap,
        address _owner
    ) EIP712("GameRewards", "1") Ownable(_owner) {
        if (address(_gd) == address(0) || _scorer == address(0)) revert ZeroAddress();
        if (_epochLength == 0) revert ZeroEpochLength();
        gd = _gd;
        scorer = _scorer;
        epochLength = _epochLength;
        epochCap = _epochCap;
    }

    /// @notice The epoch index for the current block.
    function currentEpoch() public view returns (uint256) {
        return block.timestamp / epochLength;
    }

    /// @notice The EIP-712 digest a scorer signs for `v`. Exposed so the off-chain
    ///         signer and integration tests can cross-check the hashing.
    function hashVoucher(Voucher calldata v) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(VOUCHER_TYPEHASH, v.player, v.runId, v.amount, v.deadline))
        );
    }

    /// @notice Redeem a scorer-signed voucher, releasing G$ to `v.player`.
    /// @dev Permissionless on purpose: a paymaster/relayer can submit on the
    ///      player's behalf (gas-sponsored). Funds always go to `v.player`, never
    ///      `msg.sender`. Checks-effects-interactions + nonReentrant + SafeERC20.
    function redeem(Voucher calldata v, bytes calldata signature) external nonReentrant {
        if (v.amount == 0) revert ZeroAmount();
        if (block.timestamp > v.deadline) revert VoucherExpired();
        if (consumed[v.runId]) revert VoucherAlreadyConsumed();

        address recovered = ECDSA.recover(hashVoucher(v), signature);
        if (recovered != scorer) revert BadSignature();

        uint256 epoch = currentEpoch();
        uint256 spent = epochSpent[epoch] + v.amount;
        if (spent > epochCap) revert EpochCapExceeded();

        // Effects before the external token transfer.
        consumed[v.runId] = true;
        epochSpent[epoch] = spent;

        emit Redeemed(v.player, v.runId, v.amount, epoch);
        gd.safeTransfer(v.player, v.amount);
    }

    /// @notice Rotate the trusted scorer (e.g. after a suspected key compromise).
    function setScorer(address newScorer) external onlyOwner {
        if (newScorer == address(0)) revert ZeroAddress();
        emit ScorerRotated(scorer, newScorer);
        scorer = newScorer;
    }

    /// @notice Adjust the per-epoch payout cap.
    function setEpochCap(uint256 newCap) external onlyOwner {
        emit EpochCapUpdated(epochCap, newCap);
        epochCap = newCap;
    }

    /// @notice Withdraw unspent G$ from the pool (e.g. to return grant funds).
    function withdraw(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        emit Withdrawn(to, amount);
        gd.safeTransfer(to, amount);
    }
}
