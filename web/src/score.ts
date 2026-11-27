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

  // Extract raw inputs
  const sigs = sigsR.status === "fulfilled" ? sigsR.value : [];
  const toks = [tok1R, tok2R].flatMap((r) =>
    r.status === "fulfilled" ? r.value.value : [],
  );
  const balLamports = balR.status === "fulfilled" ? balR.value : null;

  const hasHistory = sigs.length > 0;

  const oldest = hasHistory ? (sigs[sigs.length - 1].blockTime ?? nowS()) : null;
  const ageDays = oldest !== null ? (nowS() - oldest) / 86400 : Infinity;

  const weekAgo = nowS() - 7 * 86400;
  const recentSigs = sigs.filter((s) => (s.blockTime ?? 0) > weekAgo).length;

  let delegateCount = 0;
  let deadCount = 0;
  for (const { account } of toks) {
    const info = (account.data as any).parsed?.info;
    if (!info) continue;
    if (info.delegate) delegateCount++;
    if (Number(info.tokenAmount?.uiAmount ?? 1) === 0) deadCount++;
  }

  const sol = balLamports !== null ? balLamports / 1e9 : 0;

  if (import.meta.env.DEV) {
    console.log("[score] raw inputs:", { hasHistory, ageDays: Math.round(ageDays), delegateCount, deadCount, recentSigs, sol });
  }

  let score = 100;

  // Flat base penalty for any wallet with history
  if (hasHistory) score -= 4;

  // Wallet age
  if (hasHistory) {
    if (ageDays < 30) score -= 12;
    else if (ageDays < 180) score -= 8;
    else if (ageDays < 365) score -= 5;
    else if (ageDays > 730) score -= 3;
  }

  // Open approvals: -6 each, cap -24
  score -= Math.min(delegateCount * 6, 24);

  // Dead token accounts: -1 each, cap -20
  score -= Math.min(deadCount, 20);

  // Signatures in last 7 days: -1 per 4, cap -12
  score -= Math.min(Math.floor(recentSigs / 4), 12);

  // SOL at rest
  if (sol > 5) score -= 12;
  else if (sol > 1) score -= 8;
  else if (sol > 0.1) score -= 4;

  // 100 is impossible; floor at 8 so there is always room to improve
  score = Math.max(8, Math.min(96, score));

  const rows: ScoreRow[] = [
    {
      label: "Wallet age",
      status: !hasHistory ? "green"
        : ageDays < 180 ? "red"
        : ageDays < 365 ? "amber"
        : ageDays > 730 ? "amber"
        : "green",
    },
    {
      label: "Open token approvals",
      status: delegateCount === 0 ? "green" : delegateCount <= 1 ? "amber" : "red",
    },
    {
      label: "Dead token accounts",
      status: deadCount === 0 ? "green" : deadCount <= 5 ? "amber" : "red",
    },
    {
      label: "Recent activity",
      status: recentSigs < 4 ? "green" : recentSigs < 16 ? "amber" : "red",
    },
    {
      label: "SOL at rest",
      status: sol <= 0.1 ? "green" : sol <= 1 ? "amber" : "red",
    },
  ];

  const band = score <= 39 ? "Exposed" : score <= 69 ? "Tired" : "Clean";
  return { score, band, rows };
}
