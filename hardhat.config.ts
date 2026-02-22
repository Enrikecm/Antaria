import { HardhatUserConfig } from "hardhat/config";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const hasValidKey = PRIVATE_KEY && !PRIVATE_KEY.includes("YOUR_PRIVATE_KEY");

const config: HardhatUserConfig = {
    solidity: "0.8.20",
    networks: {
        ...(hasValidKey ? {
            monadTestnet: {
                url: "https://testnet-rpc.monad.xyz",
                chainId: 10143,
                accounts: [PRIVATE_KEY],
            },
        } : {}),
    },
};

export default config;
