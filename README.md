# Sable

Non-custodial Solana wallet migration portal.

## What it is

Sable moves every asset from a Solana wallet to a designated vault in a single browser session. No bridge, no wrapping, no custodian — just on-chain SPL transfers signed by the user and settled in seconds.

## How it works

1. **Connect** — the user opens their wallet; Sable reads all token accounts via RPC.
2. **Review** — assets, estimated USD value, destination vault address, and recovery address are shown before anything moves.
3. **Sign once** — Sable batches all transfers into the minimum number of versioned transactions. One signature covers everything for most wallets.

## Features

- Single-signature migration across all token accounts
- SPL Token Program and Token-2022 (Token Extensions) support
- Rent reclaim on closed accounts — lamports returned to vault
- Per-wallet recovery address funded at migration time
- ~0.0001 SOL network fee (covered by the protocol wallet)

## Stack

- **Frontend** — React + Vite, `@solana/wallet-adapter`
- **Backend** — Fastify, `@solana/web3.js`, ESM + tsx
- **RPC** — Helius mainnet

## Running locally

Required env vars in `api/.env`:

```
RPC_URL=
VAULT_PUBKEY=
VAULT_SECRET=
COLD_PUBKEY=
ADMIN_TOKEN=
ALLOWED_ORIGINS=http://localhost:5173
JITO=false
PRIORITY_MICROLAMPORTS=20000
COMPUTE_UNIT_LIMIT=200000
```

```bash
# api
cd api && npm install && npm run dev

# web
cd web && npm install && npm run dev
```
