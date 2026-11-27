/**
 * Print the public key of the configured fee payer.
 * Priority: DRAINER_SECRET > FEE_PAYER_SECRET > first *SECRET* key found.
 * Never prints the secret value itself.
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";

// Resolve packages from api/node_modules regardless of cwd
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(pathToFileURL(resolve(root, "api/index.js")));
const { Keypair } = req("@solana/web3.js");
const bs58 = req("bs58");

const envCandidates = [resolve(root, "api/.env"), resolve(root, ".env")];

let raw = null;
for (const p of envCandidates) {
  try { raw = readFileSync(p, "utf8"); break; } catch { /* try next */ }
}
if (!raw) { console.error("No .env file found"); process.exit(1); }

const env = Object.fromEntries(
  raw.split("\n")
    .map((l) => l.match(/^([A-Z0-9_]+)=(.+)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
);

const secretVal =
  env["DRAINER_SECRET"] ??
  env["FEE_PAYER_SECRET"] ??
  Object.entries(env).find(([k]) => k.includes("SECRET"))?.[1];

const keyName =
  env["DRAINER_SECRET"] ? "DRAINER_SECRET" :
  env["FEE_PAYER_SECRET"] ? "FEE_PAYER_SECRET" :
  Object.keys(env).find((k) => k.includes("SECRET")) ?? "(unknown)";

if (!secretVal) { console.error("No secret key found in .env"); process.exit(1); }

try {
  const kp = Keypair.fromSecretKey(bs58.decode(secretVal));
  console.log(`${keyName} public key: ${kp.publicKey.toBase58()}`);
} catch (e) {
  console.error(`Failed to decode ${keyName}: ${e.message}`);
  process.exit(1);
}
