import { appendFileSync, mkdirSync } from "node:fs";
mkdirSync("logs", { recursive: true });
const file = `logs/api-${new Date().toISOString().slice(0, 10)}.jsonl`;

export function log(entry: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  appendFileSync(file, line + "\n");
  console.log(line);
}
