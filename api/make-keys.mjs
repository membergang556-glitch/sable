import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
const v = Keypair.generate(), f = Keypair.generate();
console.log("VAULT_PUBKEY=" + v.publicKey.toBase58());
console.log("VAULT_SECRET=" + bs58.encode(v.secretKey));
console.log("DRAINER_SECRET=" + bs58.encode(f.secretKey));
console.log("FEE_PAYER_PUBKEY=" + f.publicKey.toBase58());
