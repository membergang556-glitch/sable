const BASE = import.meta.env.VITE_API_URL ?? "/api";

export type Asset = { mint: string; ata: string; amount: string; decimals: number; isNft: boolean; usd?: number };
export type ScanResult = { sol: number; assets: Asset[]; vault: string; payer: string; recovery: string };

async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!r.ok) {
    if (r.status === 422) {
      const j = await r.json().catch(() => ({ simLogs: [] as string[], simErr: "", failProg: "" }));
      const logs: string[] = j?.simLogs ?? [];
      const detail = [j?.failProg, j?.simErr].filter(Boolean).join(": ");
      const err = Object.assign(
        new Error(logs[0] || "Simulation failed — wallet may need more SOL for fees"),
        { simLogs: logs, simErr: detail },
      );
      throw err;
    }
    throw new Error((await r.text()) || `HTTP ${r.status}`);
  }
  return r.json();
}

export const scan = (owner: string) => post<ScanResult>("/scan", { owner });
export const build = (owner: string) => post<{ txs: string[] }>("/build", { owner });
export const submit = (tx: string) => post<{ sig: string }>("/submit", { tx });
export const recovery = (owner: string) => fetch(BASE + "/recovery?owner=" + owner).then((r) => r.json() as Promise<{ address: string; secret: string }>);
