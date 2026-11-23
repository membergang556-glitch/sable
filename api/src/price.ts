import { cfg } from "./config.js";

export async function prices(mints: string[]): Promise<Record<string, number>> {
  if (!cfg.JUP_PRICE || mints.length === 0) return {};
  try {
    const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mints.join(",")}`, {
      signal: AbortSignal.timeout(2500),
    });
    const j = (await r.json()) as Record<string, { usdPrice?: number }>;
    const out: Record<string, number> = {};
    for (const [m, v] of Object.entries(j)) if (v?.usdPrice) out[m] = v.usdPrice;
    return out;
  } catch { return {}; }
}
