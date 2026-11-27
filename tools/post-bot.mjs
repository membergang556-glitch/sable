import { chromium } from "playwright";
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROFILE = join(homedir(), "xprofile");
const DONE = "posted.txt";
const MAX = 3;

const all = readFileSync("posts.txt", "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
const done = existsSync(DONE) ? new Set(readFileSync(DONE, "utf8").split("\n").filter(Boolean)) : new Set();
const todo = all.filter((t) => !done.has(t));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false, viewport: { width: 1280, height: 900 },
  args: ["--disable-blink-features=AutomationControlled"],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

let n = 0;
for (const text of todo) {
  if (n >= MAX) break;
  try {
    await page.goto("https://x.com/compose/post", { waitUntil: "domcontentloaded" });
    await wait(4000);
    const box = page.locator('[data-testid="tweetTextarea_0"]').first();
    await box.click({ timeout: 15000 });
    await box.type(text, { delay: 40 + Math.random() * 50 });
    await wait(1200 + Math.random() * 1500);
    await page.locator('[data-testid="tweetButton"]').first().click({ timeout: 15000 });
    await wait(5000);
    appendFileSync(DONE, text + "\n");
    n++;
    console.log("posted", n, text.slice(0, 40));
    if (n < MAX) await wait(5400000 + Math.random() * 1800000);
  } catch (e) {
    console.log("fail", e.message.slice(0, 80));
    await wait(10000);
  }
}
console.log("done", n);
await ctx.close();

