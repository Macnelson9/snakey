// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GameRewards} from "../src/GameRewards.sol";

/// @notice Deploys GameRewards and (optionally) seeds its G$ reward pool.
///
/// Usage (from `contracts/`):
///   forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC_URL" --broadcast
///
/// Required env:
///   PRIVATE_KEY   deployer key, hex (forge broadcasts with it). Keep it OUT of git.
///   SCORER        the off-chain scorer's ADDRESS (the address of SCORER_PRIVATE_KEY).
///
/// Optional env (defaults shown):
///   GD_TOKEN      G$ token address           (default: GoodDollar on Celo mainnet)
///   EPOCH_LENGTH  seconds per payout epoch   (default: 86400 = 1 day)
///   EPOCH_CAP     max G$ wei payable / epoch (default: 50e18 = 50 G$)
///   OWNER         contract owner address     (default: the deployer)
///   FUND_AMOUNT   G$ wei to move from the deployer into the pool right after deploy
///                 (default: 0 = skip; the deployer must already hold this much G$)
contract Deploy is Script {
    /// GoodDollar G$ on Celo mainnet — confirmed against GoodProtocol deployment.json.
    address internal constant GD_CELO = 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address gd = vm.envOr("GD_TOKEN", GD_CELO);
        address scorer = vm.envAddress("SCORER");
        uint256 epochLength = vm.envOr("EPOCH_LENGTH", uint256(86_400));
        uint256 epochCap = vm.envOr("EPOCH_CAP", uint256(50 ether)); // 50 G$ (18 decimals)
        address owner = vm.envOr("OWNER", deployer);
        uint256 fundAmount = vm.envOr("FUND_AMOUNT", uint256(0));

        require(scorer != address(0), "SCORER address is required");

        vm.startBroadcast(pk);

        GameRewards rewards = new GameRewards(IERC20(gd), scorer, epochLength, epochCap, owner);

        if (fundAmount > 0) {
            // Seed the pool from the deployer's G$ balance (deployer must hold it).
            require(IERC20(gd).transfer(address(rewards), fundAmount), "G$ pool funding failed");
        }

        vm.stopBroadcast();

        console2.log("GameRewards deployed:", address(rewards));
        console2.log("  G$ token:    ", gd);
        console2.log("  scorer:      ", scorer);
        console2.log("  owner:       ", owner);
        console2.log("  epochLength: ", epochLength);
        console2.log("  epochCap:    ", epochCap);
        console2.log("  funded (G$): ", fundAmount);
        console2.log("Set GAME_REWARDS_ADDRESS to the deployed address above.");
    }
}
