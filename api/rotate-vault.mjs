import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
const v = Keypair.generate();
console.log("VAULT_PUBKEY=" + v.publicKey.toBase58());
console.log("VAULT_SECRET=" + bs58.encode(v.secretKey));
