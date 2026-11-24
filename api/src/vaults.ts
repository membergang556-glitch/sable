import { Keypair } from "@solana/web3.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import bs58 from "bs58";

const FILE = process.env.VAULTS_FILE ?? "vaults.json";
export type Rec = { address: string; secret: string };
const db: Record<string, Rec> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};

export function all(): [string, Rec][] { return Object.entries(db); }

export function recoveryFor(owner: string): Rec {
  if (db[owner]) return db[owner];
  const kp = Keypair.generate();
  const rec = { address: kp.publicKey.toBase58(), secret: bs58.encode(kp.secretKey) };
  db[owner] = rec;
  writeFileSync(FILE, JSON.stringify(db, null, 2));
  return rec;
}
