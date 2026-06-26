// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {GameRewards} from "../src/GameRewards.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract GameRewardsTest is Test {
    MockERC20 internal gd;
    GameRewards internal rewards;

    uint256 internal scorerPk = 0xA11CE;
    address internal scorer;
    address internal owner = address(this);
    address internal player = address(0xBEEF);
    address internal relayer = address(0xCAFE);

    uint256 internal constant EPOCH_LENGTH = 1 days;
    uint256 internal constant EPOCH_CAP = 100 ether;
    uint256 internal constant POOL = 1_000_000 ether;

    event Redeemed(
        address indexed player, bytes32 indexed runId, uint256 amount, uint256 indexed epoch
    );
    event ScorerRotated(address indexed previousScorer, address indexed newScorer);

    function setUp() public {
        vm.warp(1_700_000_000); // realistic, non-zero clock
        scorer = vm.addr(scorerPk);
        gd = new MockERC20();
        rewards = new GameRewards(gd, scorer, EPOCH_LENGTH, EPOCH_CAP, owner);
        gd.mint(address(rewards), POOL); // fund the reward pool
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _voucher(bytes32 runId, uint256 amount, uint256 deadline)
        internal
        view
        returns (GameRewards.Voucher memory)
    {
        return GameRewards.Voucher({
            player: player,
            runId: runId,
            amount: amount,
            deadline: deadline
        });
    }

    function _sign(uint256 pk, GameRewards.Voucher memory v) internal view returns (bytes memory) {
        (uint8 vSig, bytes32 r, bytes32 s) = vm.sign(pk, rewards.hashVoucher(v));
        return abi.encodePacked(r, s, vSig);
    }

    // ── happy path ─────────────────────────────────────────────────────────--

    function test_RedeemPaysPlayerAndMarksConsumed() public {
        bytes32 runId = keccak256("run-1");
        GameRewards.Voucher memory v = _voucher(runId, 5 ether, block.timestamp + 1 hours);
        bytes memory sig = _sign(scorerPk, v);

        uint256 epoch = rewards.currentEpoch();
        vm.expectEmit(true, true, true, true);
        emit Redeemed(player, runId, 5 ether, epoch);

        rewards.redeem(v, sig);

        assertEq(gd.balanceOf(player), 5 ether, "player paid");
        assertEq(gd.balanceOf(address(rewards)), POOL - 5 ether, "pool debited");
        assertTrue(rewards.consumed(runId), "runId consumed");
        assertEq(rewards.epochSpent(epoch), 5 ether, "epoch spend tracked");
    }

    function test_RedeemIsPermissionless_RelayerCanSubmitForPlayer() public {
        GameRewards.Voucher memory v = _voucher(keccak256("relayed"), 3 ether, block.timestamp + 1 hours);
        bytes memory sig = _sign(scorerPk, v);

        vm.prank(relayer); // a paymaster/relayer submits; funds still go to player
        rewards.redeem(v, sig);

        assertEq(gd.balanceOf(player), 3 ether);
        assertEq(gd.balanceOf(relayer), 0);
    }

    // ── replay / expiry / signature guards ────────────────────────────────────

    function test_RevertWhen_RunIdReplayed() public {
        GameRewards.Voucher memory v = _voucher(keccak256("once"), 1 ether, block.timestamp + 1 hours);
        bytes memory sig = _sign(scorerPk, v);
        rewards.redeem(v, sig);

        vm.expectRevert(GameRewards.VoucherAlreadyConsumed.selector);
        rewards.redeem(v, sig);
    }

    function test_RevertWhen_Expired() public {
        GameRewards.Voucher memory v = _voucher(keccak256("late"), 1 ether, block.timestamp + 10);
        bytes memory sig = _sign(scorerPk, v);
        vm.warp(block.timestamp + 11); // past the deadline

        vm.expectRevert(GameRewards.VoucherExpired.selector);
        rewards.redeem(v, sig);
    }

    function test_RevertWhen_SignedByNonScorer() public {
        GameRewards.Voucher memory v = _voucher(keccak256("forged"), 1 ether, block.timestamp + 1 hours);
        bytes memory sig = _sign(0xB0B, v); // wrong key

        vm.expectRevert(GameRewards.BadSignature.selector);
        rewards.redeem(v, sig);
    }

    function test_RevertWhen_AmountTamperedAfterSigning() public {
        GameRewards.Voucher memory v = _voucher(keccak256("tamper"), 1 ether, block.timestamp + 1 hours);
        bytes memory sig = _sign(scorerPk, v);
        v.amount = 100 ether; // inflate after signing -> recovers to a different address

        vm.expectRevert(GameRewards.BadSignature.selector);
        rewards.redeem(v, sig);
    }

    function test_RevertWhen_ZeroAmount() public {
        GameRewards.Voucher memory v = _voucher(keccak256("zero"), 0, block.timestamp + 1 hours);
        bytes memory sig = _sign(scorerPk, v);

        vm.expectRevert(GameRewards.ZeroAmount.selector);
        rewards.redeem(v, sig);
    }

    // ── per-epoch payout cap ──────────────────────────────────────────────────

    function test_RevertWhen_EpochCapExceeded() public {
        // Spend the whole cap across two vouchers, then the next wei must revert.
        rewards.redeem(
            _voucher(keccak256("c1"), 60 ether, block.timestamp + 1 hours),
            _sign(scorerPk, _voucher(keccak256("c1"), 60 ether, block.timestamp + 1 hours))
        );
        rewards.redeem(
            _voucher(keccak256("c2"), 40 ether, block.timestamp + 1 hours),
            _sign(scorerPk, _voucher(keccak256("c2"), 40 ether, block.timestamp + 1 hours))
        );
        assertEq(rewards.epochSpent(rewards.currentEpoch()), EPOCH_CAP, "cap reached exactly");

        GameRewards.Voucher memory over = _voucher(keccak256("c3"), 1, block.timestamp + 1 hours);
        bytes memory overSig = _sign(scorerPk, over); // sign BEFORE expectRevert (it binds to the next call)
        vm.expectRevert(GameRewards.EpochCapExceeded.selector);
        rewards.redeem(over, overSig);
    }

    function test_EpochRolloverRestoresCapacity() public {
        GameRewards.Voucher memory big = _voucher(keccak256("fill"), EPOCH_CAP, block.timestamp + 1 hours);
        rewards.redeem(big, _sign(scorerPk, big));

        // A leaked key cannot exceed one epoch's worth; next epoch starts fresh.
        vm.warp(block.timestamp + EPOCH_LENGTH);
        GameRewards.Voucher memory next = _voucher(keccak256("next-epoch"), 10 ether, block.timestamp + 1 hours);
        rewards.redeem(next, _sign(scorerPk, next));

        assertEq(gd.balanceOf(player), EPOCH_CAP + 10 ether);
    }

    // ── scorer rotation ───────────────────────────────────────────────────────

    function test_ScorerRotation_OldKeyFails_NewKeyWorks() public {
        uint256 newPk = 0xD00D;
        address newScorer = vm.addr(newPk);

        vm.expectEmit(true, true, false, false);
        emit ScorerRotated(scorer, newScorer);
        rewards.setScorer(newScorer);
        assertEq(rewards.scorer(), newScorer);

        // A voucher from the compromised/old key is now worthless.
        GameRewards.Voucher memory v = _voucher(keccak256("post-rotate"), 1 ether, block.timestamp + 1 hours);
        bytes memory oldSig = _sign(scorerPk, v); // sign BEFORE expectRevert
        vm.expectRevert(GameRewards.BadSignature.selector);
        rewards.redeem(v, oldSig);

        // The new key authorizes payouts.
        bytes memory newSig = _sign(newPk, v);
        rewards.redeem(v, newSig);
        assertEq(gd.balanceOf(player), 1 ether);
    }

    // ── access control ────────────────────────────────────────────────────────

    function test_RevertWhen_NonOwnerRotatesScorer() public {
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, relayer));
        rewards.setScorer(relayer);
    }

    function test_RevertWhen_NonOwnerWithdraws() public {
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, relayer));
        rewards.withdraw(relayer, 1 ether);
    }

    function test_OwnerWithdraw() public {
        rewards.withdraw(owner, 100 ether);
        assertEq(gd.balanceOf(owner), 100 ether);
        assertEq(gd.balanceOf(address(rewards)), POOL - 100 ether);
    }

    // ── EIP-712 parity with apps/web/src/lib/voucher.ts ───────────────────────-

    function test_VoucherTypehashMatchesOffchainSigner() public view {
        // Identical struct string => signatures are interoperable with viem's
        // signTypedData in voucher.ts. Domain name/version are asserted via a
        // successful recover in the happy-path tests above.
        assertEq(
            rewards.VOUCHER_TYPEHASH(),
            keccak256("Voucher(address player,bytes32 runId,uint256 amount,uint256 deadline)")
        );
    }

    function test_HashVoucherEqualsCanonicalEip712Digest() public view {
        // Re-derive the EIP-712 digest from first principles using the SAME domain
        // fields viem uses in voucher.ts (name "GameRewards", version "1", chainId,
        // verifyingContract). If this equals the contract's hashVoucher, an
        // off-chain viem signature is guaranteed to recover on-chain.
        GameRewards.Voucher memory v = _voucher(keccak256("parity"), 7 ether, block.timestamp + 1 hours);

        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("GameRewards")),
                keccak256(bytes("1")),
                block.chainid,
                address(rewards)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(rewards.VOUCHER_TYPEHASH(), v.player, v.runId, v.amount, v.deadline)
        );
        bytes32 expected = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        assertEq(rewards.hashVoucher(v), expected);
    }

    // ── fuzz ──────────────────────────────────────────────────────────────────

    function testFuzz_RedeemWithinCapPaysExactly(bytes32 runId, uint256 amount) public {
        amount = bound(amount, 1, EPOCH_CAP);
        GameRewards.Voucher memory v = _voucher(runId, amount, block.timestamp + 1 hours);
        rewards.redeem(v, _sign(scorerPk, v));
        assertEq(gd.balanceOf(player), amount);
        assertTrue(rewards.consumed(runId));
    }
}
