import { ethers, JsonRpcProvider, Wallet, Contract } from "ethers";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
    console.log("🔍 Verifying AnchorRegistry on Celo...\n");

    if (!process.env.PRIVATE_KEY || process.env.PRIVATE_KEY === "0xYOUR_PRIVATE_KEY_HERE") {
        console.error("❌ Set your PRIVATE_KEY in .env first.");
        process.exit(1);
    }

    if (!fs.existsSync("celo-config.json")) {
        console.error("❌ celo-config.json not found. Run deploy first.");
        process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync("celo-config.json", "utf-8"));
    const rpcUrl = config.network === "celo-alfajores"
        ? "https://alfajores-forno.celo-testnet.org"
        : "https://forno.celo.org";

    const provider = new JsonRpcProvider(rpcUrl);
    const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
    const contract = new Contract(config.contractAddress, config.abi, wallet);

    console.log("📋 Contract:", config.contractAddress);
    console.log("👤 Signer:", wallet.address);

    // Create test anchor data
    const testGroupId = ethers.keccak256(ethers.toUtf8Bytes("test-tanda-001" + "salt123"));
    const testRefId = ethers.keccak256(ethers.toUtf8Bytes("batch-001"));
    const testDataHash = ethers.keccak256(ethers.toUtf8Bytes("test-data-payload"));

    console.log("\n📡 Sending test anchor TX...");
    const tx = await contract.anchor(testGroupId, "TANDA_CREATED", testRefId, testDataHash);
    const receipt = await tx.wait();

    console.log("\n✅ Anchor TX successful!");
    console.log(`🔗 TX: ${config.explorerBase}/tx/${receipt.hash}`);
    console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);

    // Read anchor count
    const count = await contract.anchorCount();
    console.log(`\n📊 Total anchors: ${count.toString()}`);

    // Parse events from receipt
    for (const log of receipt.logs) {
        try {
            const parsed = contract.interface.parseLog({
                topics: log.topics as string[],
                data: log.data,
            });
            if (parsed && parsed.name === "Anchored") {
                console.log("\n📋 Anchored Event:");
                console.log("  groupId:", parsed.args.groupId);
                console.log("  anchorType:", parsed.args.anchorType);
                console.log("  refId:", parsed.args.refId);
                console.log("  dataHash:", parsed.args.dataHash);
                console.log("  timestamp:", new Date(Number(parsed.args.timestamp) * 1000).toISOString());
            }
        } catch (e) {
            // Skip non-matching logs
        }
    }

    console.log("\n🎉 Contract verification complete!");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
