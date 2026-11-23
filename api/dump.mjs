import { VersionedTransaction } from "@solana/web3.js";
import { readFileSync } from "node:fs";
const tx = VersionedTransaction.deserialize(Buffer.from(readFileSync("tx.txt", "utf8").trim(), "base64"));
console.log("sigs:", tx.signatures.length, "required:", tx.message.header.numRequiredSignatures);
console.log("blockhash:", tx.message.recentBlockhash);
for (const i of tx.message.compiledInstructions) {
  console.log("prog", i.programIdIndex, "accounts", i.accountKeyIndexes, "data", Buffer.from(i.data).toString("hex"));
}
