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

const FOLLOW_RL = /limit|try again later|unable to follow/i;
const UNFOLLOW_RL = /limit|try again later|unable to unfollow/i;

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

async function readToast(page) {
  try {
    for (const sel of ['[role="alert"]', '[data-testid="toast"]']) {
      const loc = page.locator(sel);
      if (await loc.count() > 0) {
        const text = await loc.first().innerText().catch(() => "");
        if (text.trim()) return text;
      }
    }
  } catch {}
  return "";
}

let followTrips = 0;
let unfollowTrips = 0;

// Returns true on success, null to stop the session, false to skip this row.
async function tryFollow(page, cell) {
  const FOLLOW_SEL = '[data-testid$="-follow"]:not([data-testid$="-unfollow"])';
  // pause durations: first rate-limit trip 15-30 min, second 20-40 min
  const PAUSES = [rnd(900000, 1800000), rnd(1200000, 2400000)];

  for (let attempt = 0; attempt < 3; attempt++) {
    const btn = cell.locator(FOLLOW_SEL).first();
    if (await btn.count() === 0) return false;
    await btn.click();
    await wait(rnd(1200, 2000));

    const toast = await readToast(page);
    if (FOLLOW_RL.test(toast)) {
      followTrips++;
      console.log("ratelimit, pausing");
      if (followTrips >= 3) {
        console.log("limit reached, stopping");
        return null;
      }
      await wait(PAUSES[Math.min(attempt, PAUSES.length - 1)]);
      continue;
    }

    // Verify: Follow button gone (state changed to Following)
    const unchanged = await cell.locator(FOLLOW_SEL).count() > 0;
    if (unchanged && attempt === 0) {
      await wait(3000);
      continue;
    }

    followTrips = 0;
    return true;
  }

  return false;
}

// Returns true on success, null to stop the session, false to skip this row.
async function tryUnfollow(page, cell) {
  const UNFOLLOW_SEL = '[data-testid$="-unfollow"]';
  // 10-20 min pauses for both retries
  const PAUSES = [rnd(600000, 1200000), rnd(600000, 1200000)];

  for (let attempt = 0; attempt < 3; attempt++) {
    const btn = cell.locator(UNFOLLOW_SEL).first();
    if (await btn.count() === 0) return false;
    await btn.click();
    await wait(rnd(1200, 2000));

    const toast = await readToast(page);
    if (UNFOLLOW_RL.test(toast)) {
      unfollowTrips++;
      console.log("ratelimit, pausing");
      if (unfollowTrips >= 3) {
        console.log("limit reached, stopping");
        return null;
      }
      await wait(PAUSES[Math.min(attempt, PAUSES.length - 1)]);
      continue;
    }

    // Dismiss confirmation sheet if present
    const confirm = page.locator('[data-testid="confirmationSheetConfirm"]');
    if (await confirm.count() > 0) {
      await confirm.click();
      await wait(800);
    }

    // Verify: Unfollow button gone (state changed back to Follow)
    const unchanged = await cell.locator(UNFOLLOW_SEL).count() > 0;
    if (unchanged && attempt === 0) {
      await wait(3000);
      continue;
    }

    unfollowTrips = 0;
    return true;
  }

  return false;
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
let stopFollow = false;

const cells = page.locator('[data-testid="UserCell"]');
const cellCount = await cells.count();

for (let i = 0; i < cellCount && followed < MAX_FOLLOW && !stopFollow; i++) {
  const cell = cells.nth(i);
  const handle = await getHandle(cell);
  if (!handle || followLog.has(handle)) continue;

  try {
    const result = await tryFollow(page, cell);
    if (result === null) { stopFollow = true; break; }
    if (!result) continue;
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
if (stopFollow) { await ctx.close(); process.exit(0); }

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
let stopUnfollow = false;

for (const cell of await page.locator('[data-testid="UserCell"]').all()) {
  if (unfollowed >= MAX_UNFOLLOW || stopUnfollow) break;
  const handle = await getHandle(cell);
  if (!handle || !followerSet.has(handle) || !freshLog.has(handle)) continue;

  try {
    const result = await tryUnfollow(page, cell);
    if (result === null) { stopUnfollow = true; break; }
    if (!result) continue;
    console.log("unfollow", handle);
    unfollowed++;
    await wait(rnd(8000, 25000));
  } catch (e) {
    console.log("unfollow err", handle, e.message.slice(0, 50));
  }
}

console.log("unfollows done:", unfollowed);
await ctx.close();
