import { ethers, JsonRpcProvider, Wallet, ContractFactory } from "ethers";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

const MONAD_RPC = "https://testnet-rpc.monad.xyz";
const MONAD_EXPLORER = "https://testnet.monadexplorer.com";
const CHAIN_ID = 10143;

async function main() {
    console.log("🟣 Deploying AnchorRegistry to Monad Testnet...\n");

    if (!process.env.PRIVATE_KEY || process.env.PRIVATE_KEY === "0xYOUR_PRIVATE_KEY_HERE") {
        console.error("❌ Set your PRIVATE_KEY in .env first.");
        process.exit(1);
    }

    const provider = new JsonRpcProvider(MONAD_RPC, CHAIN_ID);
    const wallet = new Wallet(process.env.PRIVATE_KEY, provider);

    console.log("📋 Deployer:", wallet.address);
    const balance = await provider.getBalance(wallet.address);
    console.log("💰 Balance:", ethers.formatEther(balance), "MON\n");

    if (balance === 0n) {
        console.error("❌ No tienes MON. Usa el faucet: https://testnet.monad.xyz");
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

    console.log("📡 Deploying to Monad Testnet...");
    const contract = await factory.deploy();
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    console.log("✅ AnchorRegistry deployed at:", address);
    console.log(`🔗 Explorer: ${MONAD_EXPLORER}/address/${address}`);

    // Save config
    const config = {
        contractAddress: address,
        deployedAt: new Date().toISOString(),
        network: "monad-testnet",
        chainId: CHAIN_ID,
        rpc: MONAD_RPC,
        deployer: wallet.address,
        explorerBase: MONAD_EXPLORER,
        abi: artifact.abi,
    };
    fs.writeFileSync("monad-config.json", JSON.stringify(config, null, 2));
    console.log("\n📁 Config saved to monad-config.json");

    // Optional: send a test anchor
    console.log("\n🧪 Sending test anchor...");
    const anchorContract = new ethers.Contract(address, artifact.abi, wallet);
    const tx = await anchorContract.anchor(
        ethers.keccak256(ethers.toUtf8Bytes("monad-blitz-test")),
        "TANDA_CREATED",
        ethers.keccak256(ethers.toUtf8Bytes("test-ref")),
        ethers.keccak256(ethers.toUtf8Bytes("test-data"))
    );
    console.log("📤 TX sent:", tx.hash);
    await tx.wait();
    console.log("✅ Test anchor confirmed!");
    console.log(`🔗 TX: ${MONAD_EXPLORER}/tx/${tx.hash}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
