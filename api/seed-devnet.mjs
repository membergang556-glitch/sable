import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import bs58 from "bs58";

const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const vault = Keypair.fromSecretKey(bs58.decode(process.env.VAULT_SECRET));
const burner = new PublicKey(process.env.BURNER);

const mint = await createMint(conn, vault, vault.publicKey, null, 6);
const ata = await getOrCreateAssociatedTokenAccount(conn, vault, mint, burner);
await mintTo(conn, vault, mint, ata.address, vault.publicKey, 1_000_000_000n);
console.log("minted", mint.toBase58(), "to", burner.toBase58());
