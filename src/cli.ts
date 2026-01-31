#!/usr/bin/env node

import { readFileSync } from "fs";
import { verify, validateTicket, getExplorerUrl } from "./index.js";

function printUsage() {
  console.log(`
agentsystems-verify - Verify notarized logs against Arweave blockchain

Usage:
  agentsystems-verify <ticket.json> <logs.zip>

Arguments:
  ticket.json   Arweave verification ticket (JSON file)
  logs.zip      ZIP file containing log files to verify

Example:
  npx agentsystems-verify arweave-ticket.json logs.zip

Ticket format:
  {
    "type": "arweave",
    "owner": "<arweave-wallet-address>",
    "namespace": "<namespace>",
    "date_start": "YYYY-MM-DD",
    "date_end": "YYYY-MM-DD"
  }

For more info: https://github.com/agentsystems/agentsystems-verify
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  if (args.length < 2) {
    console.error("Error: Missing arguments. Expected: <ticket.json> <logs.zip>");
    printUsage();
    process.exit(1);
  }

  const [ticketPath, zipPath] = args;

  try {
    // Read and validate ticket
    const ticketJson = JSON.parse(readFileSync(ticketPath, "utf-8"));
    const ticket = validateTicket(ticketJson);

    // Read ZIP file
    const zipBuffer = readFileSync(zipPath);

    console.log(`\nVerifying logs for namespace: ${ticket.namespace}`);
    console.log(`Date range: ${ticket.date_start} to ${ticket.date_end}`);
    console.log(`Owner: ${ticket.owner}\n`);

    // Run verification
    const results = await verify(ticket, zipBuffer, {
      onProgress: (msg) => console.log(`  ${msg}`),
    });

    // Print results
    console.log("\n" + "=".repeat(60));
    console.log("VERIFICATION RESULTS");
    console.log("=".repeat(60));

    console.log(`\nVerified:    ${results.verified.length} logs`);
    console.log(`Unnotarized: ${results.unnotarized.length} logs`);
    console.log(`Missing:     ${results.missing.length} logs`);

    if (results.unnotarized.length === 0 && results.missing.length === 0) {
      console.log("\nAll logs matched.\n");
      process.exit(0);
    }

    if (results.unnotarized.length > 0) {
      console.log("\n--- Unnotarized (in ZIP but not on Arweave) ---");
      for (const hash of results.unnotarized.slice(0, 10)) {
        console.log(`  ${hash}`);
      }
      if (results.unnotarized.length > 10) {
        console.log(`  ... and ${results.unnotarized.length - 10} more`);
      }
    }

    if (results.missing.length > 0) {
      console.log("\n--- Missing (on Arweave but not in ZIP) ---");
      for (const tx of results.missing.slice(0, 10)) {
        console.log(`  ${tx.hash}`);
        console.log(`    tx: ${getExplorerUrl(tx.txId)}`);
      }
      if (results.missing.length > 10) {
        console.log(`  ... and ${results.missing.length - 10} more`);
      }
    }

    console.log("");
    process.exit(1);
  } catch (err) {
    console.error(`\nError: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

main();
