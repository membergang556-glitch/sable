import { chromium } from "playwright";
import { homedir } from "node:os";
import { join } from "node:path";

const PROFILE = join(homedir(), "xprofile");
const MAX = 80;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false, viewport: { width: 1280, height: 900 },
  args: ["--disable-blink-features=AutomationControlled"],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

await page.goto("https://x.com/sable_v2/following", { waitUntil: "domcontentloaded" });
await wait(6000);

let n = 0;
let idle = 0;
let stuck = 0;

while (n < MAX && idle < 6 && stuck < 8) {
  const btns = page.locator('[data-testid$="-unfollow"]');
  const c = await btns.count();

  let target = -1;
  for (let i = 0; i < c; i++) {
    const cell = btns.nth(i).locator('xpath=ancestor::*[@data-testid="UserCell"]').first();
    const t = (await cell.innerText().catch(() => "")) || "";
    if (!t.includes("Follows you")) { target = i; break; }
  }

  if (target === -1) {
    idle++;
    await page.mouse.wheel(0, 2200);
    await wait(2800);
    continue;
  }

  const before = await btns.count();
  try {
    await btns.nth(target).scrollIntoViewIfNeeded();
    await btns.nth(target).click({ timeout: 8000, force: true });
    await wait(700);

    const ub = page.locator('button:has-text("Unfollow")').first();
    if (await ub.count().catch(() => 0)) {
      await ub.click({ timeout: 6000, force: true });
      await wait(900);
    } else {
      console.log("no dialog");
      await page.keyboard.press("Escape");
    }

    const after = await page.locator('[data-testid$="-unfollow"]').count();
    if (after >= before) {
      stuck++;
      console.log("stuck", stuck);
      await page.keyboard.press("Escape");
      await wait(2000);
      continue;
    }

    n++;
    idle = 0;
    stuck = 0;
    console.log("unfollowed", n);
    await wait(900 + Math.random() * 800);
  } catch (e) {
    console.log("fail", e.message.slice(0, 60));
    await page.keyboard.press("Escape").catch(() => {});
    await wait(2000);
  }
}

console.log("done", n);
await wait(10000);
await ctx.close();

