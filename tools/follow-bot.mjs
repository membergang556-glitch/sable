import { chromium } from "playwright";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROFILE = join(homedir(), "xprofile");
const LOG = "following-log.txt";
const MAX_FOLLOW = 30;
const MAX_UNFOLLOW = 20;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (lo, hi) => lo + Math.random() * (hi - lo);

function loadLog() {
  if (!existsSync(LOG)) return new Set();
  return new Set(
    readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => l.split("\t")[0].toLowerCase()),
  );
}

function appendLog(handle) {
  appendFileSync(LOG, handle + "\t" + new Date().toISOString() + "\n");
}

async function getHandle(cell) {
  try {
    const href = await cell.locator('a[href^="/"]').first().getAttribute("href");
    const seg = (href || "").replace(/^\//, "").split("/")[0].toLowerCase();
    return seg && !/^(i|home|search|explore|notifications|messages|settings)$/.test(seg)
      ? seg
      : null;
  } catch {
    return null;
  }
}

async function scrollCollect(page, times) {
  for (let i = 0; i < times; i++) {
    await page.mouse.wheel(0, 2200);
    await wait(rnd(1600, 2600));
  }
}

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 900 },
  args: ["--disable-blink-features=AutomationControlled"],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

// ---- Part 1: Follow from recommendations ----

await page.goto("https://x.com/i/connect_people", { waitUntil: "domcontentloaded" });
await wait(rnd(4000, 7000));

const followLog = loadLog();
let followed = 0;

const cells = page.locator('[data-testid="UserCell"]');
const cellCount = await cells.count();

for (let i = 0; i < cellCount && followed < MAX_FOLLOW; i++) {
  const cell = cells.nth(i);
  const handle = await getHandle(cell);
  if (!handle || followLog.has(handle)) continue;

  try {
    // data-testid ends with "-follow" but NOT "-unfollow"
    const btn = cell.locator('[data-testid$="-follow"]:not([data-testid$="-unfollow"])').first();
    if (await btn.count() === 0) continue;
    await btn.click();
    followLog.add(handle);
    appendLog(handle);
    console.log("follow", handle);
    followed++;
    await wait(rnd(8000, 25000));
  } catch (e) {
    console.log("follow err", handle, e.message.slice(0, 50));
  }
}

console.log("follows done:", followed);

// ---- Part 2: Unfollow on follow-back ----

let me = "";
try {
  const href = await page.$eval(
    '[data-testid="AppTabBar_Profile_Link"]',
    (a) => a.getAttribute("href"),
  );
  me = (href || "").replace(/^\//, "").split("/")[0];
} catch {
  console.log("could not read own handle, skipping unfollow");
  await ctx.close();
  process.exit(0);
}
if (!me) {
  console.log("handle empty, skipping unfollow");
  await ctx.close();
  process.exit(0);
}
console.log("me:", me);

// Collect followers
await page.goto("https://x.com/" + me + "/followers", { waitUntil: "domcontentloaded" });
await wait(2800);
await scrollCollect(page, 3);

const followerSet = new Set();
for (const cell of await page.locator('[data-testid="UserCell"]').all()) {
  const h = await getHandle(cell);
  if (h) followerSet.add(h);
}
console.log("followers collected:", followerSet.size);

// Collect following, unfollow those who followed back and are in our log
await page.goto("https://x.com/" + me + "/following", { waitUntil: "domcontentloaded" });
await wait(2800);
await scrollCollect(page, 3);

const freshLog = loadLog();
let unfollowed = 0;

for (const cell of await page.locator('[data-testid="UserCell"]').all()) {
  if (unfollowed >= MAX_UNFOLLOW) break;
  const handle = await getHandle(cell);
  if (!handle || !followerSet.has(handle) || !freshLog.has(handle)) continue;

  try {
    const btn = cell.locator('[data-testid$="-unfollow"]').first();
    if (await btn.count() === 0) continue;
    await btn.click();
    await wait(900);
    const confirm = page.locator('[data-testid="confirmationSheetConfirm"]');
    if (await confirm.count() > 0) await confirm.click();
    console.log("unfollow", handle);
    unfollowed++;
    await wait(rnd(8000, 25000));
  } catch (e) {
    console.log("unfollow err", handle, e.message.slice(0, 50));
  }
}

console.log("unfollows done:", unfollowed);
await ctx.close();
