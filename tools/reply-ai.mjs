import { chromium } from "playwright";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROFILE = join(homedir(), "xprofile");
const DONE = "done.txt";
const SKIPPED = "skipped.txt";
const POOL = "qpool.json";
const MAX = 40;
const PER_RUN = 16;
const KEY = process.env.VENICE_API_KEY;
if (!KEY) { console.log("VENICE_API_KEY not set"); process.exit(1); }

const WALLET_Q = [
  '"which wallet should i use"', '"best wallet for solana"', '"what wallet do you use"',
  '"wallet recommendations"', '"is phantom safe"', '"is solflare safe"', '"is my wallet safe"',
  '"my phantom" sol', '"my solflare"', '"cant send sol"', '"sol stuck in"',
  '"wallet not working" sol', '"wallet keeps disconnecting"', '"import my wallet"',
  '"lost my seed phrase"', '"moved my sol off"', '"withdraw sol from"', '"new to solana"',
  '"just bought my first sol"', '"how do i store sol"', '"how to transfer sol"',
  '"first wallet" solana', '"burner wallet" solana', '"fresh wallet" solana',
  '"self custody" solana', '"wallet drained"', '"got drained" sol', '"lost my sol"',
  '"hacked wallet" solana', '"revoke approvals"', '"connect wallet" solana',
  '"hot wallet" vs', '"cold wallet" solana', '"multisig" solana', '"ledger" solana',
  '"wallet setup"', '"which solana wallet"', '"safe wallet" solana', '"send sol" help'
];

const TOKEN_Q = [
  '"just aped"', '"aped in" sol', '"my bag" sol', '"sold too early"', '"dev sold"',
  '"lp pulled"', '"first memecoin"', '"rug pulled" solana', '"down bad" sol',
  '"take profit" solana', '"which memecoin"', '"$SOL" bag', '"mcap" solana',
  '"holding since" sol', '"memecoin wallet"', '"new mint" solana', '"bonding curve"',
  '"pump fun" launch', '"trenches" solana', '"snipe" solana'
];

const OPS = [
  "", " -filter:replies", " -filter:links", " -filter:replies -filter:links",
  " -filter:replies -filter:media", " lang:en -filter:replies", "",
  " -filter:replies -filter:links -filter:media"
];

const JUNK = /this is actually crazy|link in bio|read more|thread below|\u{1F9F5}|follow for more|comment below|tag a friend/i;

const rnd = (n) => Math.floor(Math.random() * n);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function pickQueries() {
  let pool = [];
  try { pool = JSON.parse(readFileSync(POOL, "utf8")); } catch {}
  if (!Array.isArray(pool) || pool.length < PER_RUN) {
    pool = shuffle([...WALLET_Q.map((q) => ({ q, lane: "wallet" })), ...TOKEN_Q.map((q) => ({ q, lane: "token" }))]);
  }
  const out = pool.splice(0, PER_RUN);
  writeFileSync(POOL, JSON.stringify(pool));
  return out;
}

const WALLET_ANGLES = [
  "Answer their question straight, no warm-up.",
  "Agree with them, then say what you would actually do.",
  "Give one short practical tip. Mention Sable once, wherever it fits.",
  "Correct them or add a nuance they missed.",
  "Dry one-liner, then the fix.",
  "Ask one short follow-up question, then one line of help.",
  "Blunt, slightly tired tone. No pleasantries.",
  "Explain the mechanism briefly. No hype words."
];

const TOKEN_ANGLES = [
  "Say where the bag should actually sit. One clause on Sable.",
  "React to the trade like a person, then one line about custody.",
  "Point out the risk of keeping everything in one hot wallet.",
  "Answer them and land on a fresh wallet per play.",
  "Short, dry, mildly amused. One Sable clause.",
  "Name the specific coin or entry, then where to hold it.",
  "Agree, then say you would not keep that sitting in the same wallet.",
  "One-liner about the play, one line about the wallet it lives in."
];

const GATE = `Classify an X post for a reply bot for Sable, a Solana wallet app.
Reply WALLET if the post is about a person using, choosing, losing or moving funds in a crypto wallet: drained or hacked funds, stolen SOL, seed phrase, self-custody, which wallet to use, importing or migrating a wallet, hardware wallet, just bought sol, withdrawing off an exchange, wallet stuck or broken, a question about a named wallet app.
Reply TOKEN if the post is about holding, buying, selling, launching or losing a token or memecoin on Solana, even if no wallet is mentioned: aped in, bag, rug, new mint, pump.fun, entry, down bad, sold early, launch, ticker talk with a position.
Reply NO for: pure price predictions with no position, giveaways, gm threads, project or press announcements, airdrop farming, bare chart images, news recaps, non-crypto.
Answer with one word only: WALLET, TOKEN or NO.`;

const WALLET_SYS = `You write replies on X for Sable, a non-custodial Solana wallet app. Sable moves a wallet's whole balance into a fresh vault in one signature and hands the user the new key. About 15 seconds.

Hard rules:
- Under 25 words.
- If the post asks a question, answer it in the first clause. Never open by describing Sable.
- Reference something specific from the post, so the reply could not be pasted under a different tweet.
- Mention Sable once, not always last. You may shorten it: "a one-sig vault move", "fresh vault, your key".
- Capital letter at the start. No emoji, no hashtags, no links, no "ser".
- Do not reuse a skeleton from the recent replies shown.

Follow the ANGLE. Return only the reply text.`;

const TOKEN_SYS = `You write replies on X for Sable, a non-custodial Solana wallet app. Sable moves a wallet's whole balance into a fresh vault in one signature.

The post is about a token, not a wallet. Do not describe Sable's features. The hook is custody: where the bag actually sits, one wallet per play, not leaving everything in one hot wallet.

Hard rules:
- Under 22 words.
- Name the ticker, the coin, or the exact trade detail from the post. Required.
- One mention of Sable, short: "a fresh vault per play", "sable", "one-sig move".
- Capital letter at the start. No emoji, no hashtags, no links, no "congrats", no "this is the way", no "ser".
- Do not reuse a skeleton from the recent replies shown.

Follow the ANGLE. Return only the reply text.`;

async function call(messages, temperature, maxTokens) {
  const r = await fetch("https://api.venice.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
    body: JSON.stringify({ model: "llama-3.3-70b", messages, temperature, max_tokens: maxTokens }),
  });
  if (!r.ok) throw new Error("api " + r.status);
  const j = await r.json();
  return (j.choices?.[0]?.message?.content || "").trim();
}

async function classify(text) {
  const out = await call([{ role: "system", content: GATE }, { role: "user", content: text }], 0, 4);
  const m = out.toUpperCase().match(/WALLET|TOKEN|NO/);
  return m ? m[0] : "NO";
}

const head = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).slice(0, 4).join(" ");
const norm = (s) => s.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 90);
const handleOf = (u) => (u.match(/x\.com\/([^/]+)\/status/) || [])[1] || u;
const recent = [];
const seenText = new Set();
const perAuthor = new Map();
const clean = (s) => s.replace(/^reply:\s*/i, "").replace(/^"|"$/g, "").replace(/\s+/g, " ").trim();

async function writeReply(text, mode) {
  const angles = mode === "token" ? TOKEN_ANGLES : WALLET_ANGLES;
  const sys = mode === "token" ? TOKEN_SYS : WALLET_SYS;
  const user =
    "ANGLE: " + angles[rnd(angles.length)] + "\n\n" +
    (recent.length ? "RECENT REPLIES, do not reuse their opening or shape:\n" + recent.slice(-5).map((r) => "- " + r).join("\n") + "\n\n" : "") +
    "POST:\n" + text;

  let out = "";
  for (let i = 0; i < 3; i++) {
    out = clean(await call([{ role: "system", content: sys }, { role: "user", content: user }], 0.95, 90));
    if (!out) continue;
    if (!recent.some((r) => head(r) === head(out))) break;
  }
  if (out && !/sable|sig|vault/i.test(out)) out = out.replace(/[.]?$/, "") + ". sable does it in one sig";
  return out;
}

const load = (f) => (existsSync(f) ? new Set(readFileSync(f, "utf8").split("\n").filter(Boolean)) : new Set());
const done = load(DONE);
const seen = new Set([...load(SKIPPED)]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false, viewport: { width: 1280, height: 900 },
  args: ["--disable-blink-features=AutomationControlled"],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

const targets = [];
const laneOf = new Map();
for (const { q, lane } of pickQueries()) {
  const term = q + OPS[rnd(OPS.length)];
  console.log("[" + lane + "] search:", term);
  try {
    await page.goto("https://x.com/search?q=" + encodeURIComponent(term) + "&f=live", { waitUntil: "domcontentloaded" });
    await wait(4200);
    for (let s = 0; s < 3; s++) {
      const hrefs = await page.$$eval('a[href*="/status/"]', (as) => as.map((a) => a.href)).catch(() => []);
      for (const h of hrefs) {
        const u = h.split("?")[0];
        if (!u.includes("/status/") || /\/photo\/|\/analytics/.test(u)) continue;
        if (done.has(u) || seen.has(u) || laneOf.has(u)) continue;
        laneOf.set(u, lane);
        targets.push(u);
      }
      await page.mouse.wheel(0, 1800);
      await wait(2000);
    }
  } catch (e) { console.log("search fail", e.message.slice(0, 50)); }
  await wait(2200);
}

console.log(targets.length, "raw targets");
let n = 0;
for (const url of targets) {
  if (n >= MAX) break;
  const who = handleOf(url);
  if ((perAuthor.get(who) || 0) >= 2) { console.log("skip:author", who); continue; }
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await wait(2600);
    if (await page.locator('article:has-text("@sable_v2")').count() > 0) { console.log("skip:replied"); continue; }

    const body = ((await page.locator('[data-testid="tweetText"]').first().innerText().catch(() => "")) || "").trim();
    if (body.length < 25) { console.log("skip:short"); appendFileSync(SKIPPED, url + "\n"); continue; }
    if (/^[\$\w\s.]{0,12}$/.test(body)) { console.log("skip:junk"); appendFileSync(SKIPPED, url + "\n"); continue; }
    if (JUNK.test(body)) { console.log("skip:shill"); appendFileSync(SKIPPED, url + "\n"); continue; }

    const key = norm(body);
    if (seenText.has(key)) { console.log("skip:dupe"); appendFileSync(SKIPPED, url + "\n"); continue; }
    seenText.add(key);

    const text = body.slice(0, 700);
    const mode = await classify(text);
    if (mode === "NO") { console.log("skip:offtopic"); appendFileSync(SKIPPED, url + "\n"); continue; }

    const reply = await writeReply(text, mode);
    if (!reply || reply.length < 12) { console.log("skip:empty"); appendFileSync(SKIPPED, url + "\n"); continue; }
    console.log("[" + mode + "] reply:", reply);

    await page.locator('[data-testid="reply"]').first().click({ timeout: 15000 });
    await wait(1800);
    const box = page.locator('[data-testid="tweetTextarea_0"]').first();
    await box.waitFor({ state: "visible", timeout: 15000 });
    await box.click();
    await wait(500);
    await page.keyboard.type(reply, { delay: 45 });
    await wait(2200);
    await page.keyboard.press("Control+Enter");
    await wait(3500);

    let still = "";
    if (await box.count()) still = (await box.innerText().catch(() => "")).trim();
    if (still.length > 0) { await page.keyboard.press("Control+Enter"); await wait(3500); }

    recent.push(reply);
    perAuthor.set(who, (perAuthor.get(who) || 0) + 1);
    appendFileSync(DONE, url + "\n");
    n++;
    console.log("ok", n);
    if (n % 12 === 0) await wait(600000 + Math.random() * 900000);
    else await wait(30000 + Math.random() * 120000);
  } catch (e) {
    console.log("fail", e.message.slice(0, 70));
    await wait(8000);
  }
}
console.log("done", n);
await ctx.close();
