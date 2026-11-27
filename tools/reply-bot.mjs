import { chromium } from "playwright";
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROFILE = join(homedir(), "xprofile");
const DONE = "done.txt";
const MAX = 30;

const QUERIES = [
  '"got drained"', '"which wallet"', '"lost my sol"', '"best wallet" solana',
  '"self custody"', '"seed phrase" solana', '"just bought sol"', '"import wallet"',
];

const texts = readFileSync("replies.txt", "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
const done = existsSync(DONE) ? new Set(readFileSync(DONE, "utf8").split("\n").filter(Boolean)) : new Set();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false, viewport: { width: 1280, height: 900 },
  args: ["--disable-blink-features=AutomationControlled"],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

const targets = [];
for (const q of QUERIES) {
  await page.goto("https://x.com/search?q=" + encodeURIComponent(q) + "&f=live", { waitUntil: "domcontentloaded" });
  await wait(4500);
  const hrefs = await page.$$eval('a[href*="/status/"]', (as) => as.map((a) => a.href)).catch(() => []);
  for (const h of hrefs) {
    const u = h.split("?")[0];
    if (u.includes("/status/") && !/\/photo\/|\/analytics/.test(u) && !done.has(u) && !targets.includes(u)) targets.push(u);
  }
  await wait(2500);
}

console.log(targets.length, "targets");
let n = 0;
for (const url of targets) {
  if (n >= MAX) break;
  const text = texts[Math.floor(Math.random() * texts.length)];
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await wait(3500);
    if (await page.locator('article:has-text("@sable_v2")').count() > 0) { console.log("skip", url); continue; }
    await page.locator('[data-testid="reply"]').first().click({ timeout: 15000 });
    await wait(2000);

    const box = page.locator('[data-testid="tweetTextarea_0"]').first();
    await box.waitFor({ state: "visible", timeout: 15000 });
    await box.click();
    await wait(600);
    await page.keyboard.type(text, { delay: 55 });
    await wait(2500);

    await page.keyboard.press("Control+Enter");
    await wait(4000);

    let still = "";
    if (await box.count()) still = (await box.innerText().catch(() => "")).trim();
    if (still.length > 0) {
      await page.keyboard.press("Control+Enter");
      await wait(4000);
    }

    appendFileSync(DONE, url + "\n");
    n++;
    console.log("ok", n, url);
    if (n % 8 === 0) await wait(480000 + Math.random() * 720000);
    else await wait(35000 + Math.random() * 205000);
  } catch (e) {
    console.log("fail", url, e.message.slice(0, 80));
    await wait(8000);
  }
}
console.log("done", n);
await ctx.close();

