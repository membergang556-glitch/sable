import { Connection, PublicKey } from "@solana/web3.js";

const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const TOKEN_PROG = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const nowS = () => Math.floor(Date.now() / 1000);

export const CHECK_LABELS = [
  "Wallet age",
  "Open token approvals",
  "Dead token accounts",
  "Recent activity",
  "SOL at rest",
] as const;

export type RowStatus = "green" | "amber" | "red";
export type ScoreRow = { label: string; status: RowStatus };
export type ScoreResult = { score: number; band: string; rows: ScoreRow[] };

function timed<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

export async function scoreWallet(owner: string): Promise<ScoreResult> {
  const pk = new PublicKey(owner);

  const [sigsR, tok1R, tok2R, balR] = await Promise.allSettled([
    timed(conn.getSignaturesForAddress(pk, { limit: 1000 }), 5000),
    timed(conn.getParsedTokenAccountsByOwner(pk, { programId: TOKEN_PROG }), 5000),
    timed(conn.getParsedTokenAccountsByOwner(pk, { programId: TOKEN_2022 }), 5000),
    timed(conn.getBalance(pk), 4000),
  ]);

  let score = 100;
  const rows: ScoreRow[] = [];

  // Wallet age
  let agePenalty = 0;
  let actPenalty = 0;
  if (sigsR.status === "fulfilled" && sigsR.value.length > 0) {
    const sigs = sigsR.value;
    const oldest = sigs[sigs.length - 1].blockTime ?? nowS();
    const ageDays = (nowS() - oldest) / 86400;
    agePenalty = ageDays < 30 ? 15 : ageDays < 180 ? 8 : 0;
    const weekAgo = nowS() - 7 * 86400;
    const recent = sigs.filter((s) => (s.blockTime ?? 0) > weekAgo).length;
    actPenalty = recent > 100 ? 10 : recent > 30 ? 5 : 0;
  }
  score -= agePenalty;
  rows.push({ label: "Wallet age", status: agePenalty === 0 ? "green" : agePenalty === 8 ? "amber" : "red" });

  // Token approvals + dead accounts
  let delegateCount = 0;
  let deadCount = 0;
  for (const r of [tok1R, tok2R]) {
    if (r.status !== "fulfilled") continue;
    for (const { account } of r.value.value) {
      const info = (account.data as any).parsed?.info;
      if (!info) continue;
      if (info.delegate) delegateCount++;
      if (Number(info.tokenAmount?.uiAmount ?? 1) === 0) deadCount++;
    }
  }

  const appPenalty = delegateCount > 10 ? 20 : delegateCount > 3 ? 10 : delegateCount > 0 ? 4 : 0;
  score -= appPenalty;
  rows.push({ label: "Open token approvals", status: delegateCount === 0 ? "green" : delegateCount <= 3 ? "amber" : "red" });

  const deadPenalty = deadCount > 40 ? 20 : deadCount > 15 ? 10 : deadCount > 5 ? 4 : 0;
  score -= deadPenalty;
  rows.push({ label: "Dead token accounts", status: deadCount === 0 ? "green" : deadCount <= 5 ? "amber" : "red" });

  score -= actPenalty;
  rows.push({ label: "Recent activity", status: actPenalty === 0 ? "green" : actPenalty === 5 ? "amber" : "red" });

  // SOL at rest
  let solPenalty = 0;
  if (balR.status === "fulfilled") {
    const sol = balR.value / 1e9;
    solPenalty = sol > 5 ? 5 : sol > 1 ? 3 : 0;
    rows.push({ label: "SOL at rest", status: sol <= 1 ? "green" : sol <= 5 ? "amber" : "red" });
  } else {
    rows.push({ label: "SOL at rest", status: "green" });
  }
  score -= solPenalty;

  score = Math.max(5, Math.min(100, score));
  const band = score <= 39 ? "Exposed" : score <= 69 ? "Tired" : "Clean";
  return { score, band, rows };
}
