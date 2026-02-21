import { HardhatUserConfig } from "hardhat/config";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const hasValidKey = PRIVATE_KEY && !PRIVATE_KEY.includes("YOUR_PRIVATE_KEY");

const config: HardhatUserConfig = {
    solidity: "0.8.20",
    networks: {
        ...(hasValidKey ? {
            celo: {
                type: "http" as const,
                url: "https://forno.celo.org",
                chainId: 42220,
                accounts: [PRIVATE_KEY],
            },
            alfajores: {
                type: "http" as const,
                url: "https://alfajores-forno.celo-testnet.org",
                chainId: 44787,
                accounts: [PRIVATE_KEY],
            },
            monadTestnet: {
                type: "http" as const,
                url: "https://testnet-rpc.monad.xyz",
                chainId: 10143,
                accounts: [PRIVATE_KEY],
            },
        } : {}),
    },
};

export default config;
