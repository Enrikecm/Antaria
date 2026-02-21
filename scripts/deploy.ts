import { ethers, JsonRpcProvider, Wallet, ContractFactory } from "ethers";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
    console.log("🚀 Deploying AnchorRegistry to Celo...\n");

    if (!process.env.PRIVATE_KEY || process.env.PRIVATE_KEY === "0xYOUR_PRIVATE_KEY_HERE") {
        console.error("❌ Set your PRIVATE_KEY in .env first.");
        process.exit(1);
    }

    const network = process.argv[2] || "celo";
    const rpcUrl = network === "alfajores"
        ? "https://alfajores-forno.celo-testnet.org"
        : "https://forno.celo.org";
    const explorerBase = network === "alfajores"
        ? "https://alfajores.celoscan.io"
        : "https://celoscan.io";

    const provider = new JsonRpcProvider(rpcUrl);
    const wallet = new Wallet(process.env.PRIVATE_KEY, provider);

    console.log("📋 Deployer:", wallet.address);
    const balance = await provider.getBalance(wallet.address);
    console.log("💰 Balance:", ethers.formatEther(balance), "CELO\n");

    if (balance === 0n) {
        console.error("❌ No tienes CELO. Necesitas al menos 0.01 CELO para deploy.");
        process.exit(1);
    }

    // Read compiled contract
    const artifactPath = "./artifacts/contracts/AnchorRegistry.sol/AnchorRegistry.json";
    if (!fs.existsSync(artifactPath)) {
        console.error("❌ Compile first: npx hardhat compile");
        process.exit(1);
    }

    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);

    console.log("📡 Deploying...");
    const contract = await factory.deploy();
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    console.log("✅ AnchorRegistry deployed at:", address);
    console.log(`🔗 Explorer: ${explorerBase}/address/${address}`);

    // Save config
    const config = {
        contractAddress: address,
        deployedAt: new Date().toISOString(),
        network: network === "alfajores" ? "celo-alfajores" : "celo-mainnet",
        deployer: wallet.address,
        explorerBase,
        abi: artifact.abi,
    };
    fs.writeFileSync("celo-config.json", JSON.stringify(config, null, 2));
    console.log("\n📁 Config saved to celo-config.json");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
