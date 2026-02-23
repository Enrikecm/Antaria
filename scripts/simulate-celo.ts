import { ethers, JsonRpcProvider, Wallet, Contract } from "ethers";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

const CELO_RPC = "https://rpc.ankr.com/celo";
const CELO_EXPLORER = "https://celoscan.io";
const CHAIN_ID = 42220;

async function main() {
    console.log("🟢 Simulating Antaria anchor events on Celo Mainnet...\n");

    if (!process.env.PRIVATE_KEY) {
        console.error("❌ Set PRIVATE_KEY in .env");
        process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync("./celo-config.json", "utf-8"));
    const provider = new JsonRpcProvider(CELO_RPC, CHAIN_ID);
    const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
    const contract = new Contract(config.contractAddress, config.abi, wallet);

    console.log("📋 Contract:", config.contractAddress);
    console.log("📋 Deployer:", wallet.address);
    const balance = await provider.getBalance(wallet.address);
    console.log("💰 Balance:", ethers.formatEther(balance), "CELO\n");

    const salt = "antaria-celo-buildathon";

    const events = [
        {
            type: "TANDA_CREATED",
            tandaId: "tanda-celo-001",
            refId: "evt-celo-001",
            data: { name: "Tanda Navideña 2026", slots: 10, amount: 500, currency: "MXN" },
        },
        {
            type: "TANDA_ACTIVATED",
            tandaId: "tanda-celo-001",
            refId: "evt-celo-002",
            data: { participants: 10, startDate: "2026-03-01" },
        },
        {
            type: "INITIAL_FUND_COMPLETED",
            tandaId: "tanda-celo-001",
            refId: "evt-celo-003",
            data: { totalFund: 5000, currency: "MXN", contributions: 10 },
        },
    ];

    for (const event of events) {
        const groupId = ethers.keccak256(ethers.toUtf8Bytes(event.tandaId + salt));
        const refId = ethers.keccak256(ethers.toUtf8Bytes(event.refId + salt));
        const dataHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(event.data) + salt));

        console.log(`📤 Anchoring ${event.type}...`);
        const tx = await contract.anchor(groupId, event.type, refId, dataHash);
        console.log(`   TX: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
        console.log(`   🔗 ${CELO_EXPLORER}/tx/${tx.hash}\n`);
    }

    const count = await contract.anchorCount();
    console.log(`\n🎉 Total anchors on Celo: ${count}`);
    console.log("✅ Simulation complete!");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
