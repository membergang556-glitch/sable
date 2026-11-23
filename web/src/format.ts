export const short = (a: string, n = 4) => `${a.slice(0, n)}…${a.slice(-n)}`;

export function amount(raw: string, decimals: number) {
  const v = BigInt(raw);
  if (decimals === 0) return v.toLocaleString("en-US");
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
  return frac ? `${whole.toLocaleString("en-US")}.${frac}` : whole.toLocaleString("en-US");
}

export const usd = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : n > 0 ? `$${n.toFixed(2)}` : "";
