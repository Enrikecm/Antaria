import { ethers, JsonRpcProvider, Wallet } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
    const provider = new JsonRpcProvider("https://forno.celo.org");
    const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);

    console.log("📋 Wallet:", wallet.address);
    const balance = await provider.getBalance(wallet.address);
    console.log("💰 Balance:", ethers.formatEther(balance), "CELO");

    if (balance === 0n) {
        console.log("\n⏳ Aún no tienes CELO. Espera a que te los envíen.");
    } else {
        console.log("\n✅ ¡Tienes fondos! Listo para deploy.");
    }
}

main().catch(console.error);
