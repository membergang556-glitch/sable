import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { conn, withRetry } from "./rpc.js";
import { cfg } from "./config.js";
import { runtime } from "./admin.js";

export type Found = {
  mint: PublicKey; ata: PublicKey; amount: bigint; decimals: number;
  isNft: boolean; programId: PublicKey;
};

export async function scan(owner: PublicKey) {
  const sol = await withRetry(() => conn.getBalance(owner));
  const found: Found[] = [];

  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const res = await withRetry(() => conn.getParsedTokenAccountsByOwner(owner, { programId }));
    for (const { pubkey, account } of res.value) {
      const info = (account.data as any).parsed.info;
      const amount = BigInt(info.tokenAmount.amount);
      const isNft = info.tokenAmount.decimals === 0 && amount === 1n;
      if (runtime.skipMints.has(info.mint)) continue;
      if (isNft && !runtime.sweepNfts) continue;
      found.push({ mint: new PublicKey(info.mint), ata: pubkey, amount, decimals: info.tokenAmount.decimals, isNft, programId });
    }
  }
  return { sol, found };
}
