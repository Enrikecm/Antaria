import { ethers, JsonRpcProvider, Wallet, ContractFactory } from "ethers";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

// Default to alfajores (testnet). Use --mainnet flag for mainnet.
const isMainnet = process.argv.includes("--mainnet");

const CELO_RPC = isMainnet
    ? "https://forno.celo.org"
    : "https://alfajores-forno.celo-testnet.org";
const CELO_EXPLORER = isMainnet
    ? "https://celoscan.io"
    : "https://alfajores.celoscan.io";
const CHAIN_ID = isMainnet ? 42220 : 44787;
const NETWORK_NAME = isMainnet ? "celo-mainnet" : "celo-alfajores";

async function main() {
    console.log(`🟢 Deploying AnchorRegistry to Celo ${isMainnet ? "Mainnet" : "Alfajores Testnet"}...\n`);

    if (!process.env.PRIVATE_KEY || process.env.PRIVATE_KEY === "0xYOUR_PRIVATE_KEY_HERE") {
        console.error("❌ Set your PRIVATE_KEY in .env first.");
        process.exit(1);
    }

    const provider = new JsonRpcProvider(CELO_RPC, CHAIN_ID);
    const wallet = new Wallet(process.env.PRIVATE_KEY, provider);

    console.log("📋 Deployer:", wallet.address);
    const balance = await provider.getBalance(wallet.address);
    console.log("💰 Balance:", ethers.formatEther(balance), "CELO\n");

    if (balance === 0n) {
        console.error("❌ No tienes CELO. Usa el faucet: https://faucet.celo.org");
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

    console.log(`📡 Deploying to Celo ${isMainnet ? "Mainnet" : "Alfajores"}...`);
    const contract = await factory.deploy();
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    console.log("✅ AnchorRegistry deployed at:", address);
    console.log(`🔗 Explorer: ${CELO_EXPLORER}/address/${address}`);

    // Save config
    const config = {
        contractAddress: address,
        deployedAt: new Date().toISOString(),
        network: NETWORK_NAME,
        chainId: CHAIN_ID,
        rpc: CELO_RPC,
        deployer: wallet.address,
        explorerBase: CELO_EXPLORER,
        abi: artifact.abi,
    };
    fs.writeFileSync("celo-config.json", JSON.stringify(config, null, 2));
    console.log("\n📁 Config saved to celo-config.json");

    // Optional: send a test anchor
    console.log("\n🧪 Sending test anchor...");
    const anchorContract = new ethers.Contract(address, artifact.abi, wallet);
    const tx = await anchorContract.anchor(
        ethers.keccak256(ethers.toUtf8Bytes("celo-buildathon-test")),
        "TANDA_CREATED",
        ethers.keccak256(ethers.toUtf8Bytes("test-ref")),
        ethers.keccak256(ethers.toUtf8Bytes("test-data"))
    );
    console.log("📤 TX sent:", tx.hash);
    await tx.wait();
    console.log("✅ Test anchor confirmed!");
    console.log(`🔗 TX: ${CELO_EXPLORER}/tx/${tx.hash}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
