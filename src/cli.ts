#!/usr/bin/env node

import { readFileSync, existsSync } from "fs";
import chalk from "chalk";
import { verify, validateTicket, getExplorerUrl } from "./index.js";

function printUsage() {
  console.log(`
${chalk.bold('agentsystems-verify')} - Verify notarized logs against Arweave blockchain

${chalk.bold('Usage:')}
  agentsystems-verify <ticket.json> <logs.zip>

${chalk.bold('Arguments:')}
  ticket.json   Arweave verification ticket (JSON file)
  logs.zip      ZIP file containing log files to verify

${chalk.bold('Example:')}
  npx agentsystems-verify arweave-ticket.json logs.zip

${chalk.bold('Ticket format:')}
  {
    "type": "arweave",
    "owner": "<arweave-wallet-address>",
    "namespace": "<namespace>",
    "date_start": "YYYY-MM-DD",
    "date_end": "YYYY-MM-DD"
  }

For more info: ${chalk.cyan('https://github.com/agentsystems/agentsystems-verify')}
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  if (args.length < 2) {
    console.error(chalk.red("Error: Missing arguments. Expected: <ticket.json> <logs.zip>"));
    printUsage();
    process.exit(1);
  }

  const [ticketPath, zipPath] = args;

  // Check files exist
  if (!existsSync(ticketPath)) {
    console.error(chalk.red(`Error: Ticket file not found: ${ticketPath}`));
    process.exit(1);
  }
  if (!existsSync(zipPath)) {
    console.error(chalk.red(`Error: ZIP file not found: ${zipPath}`));
    process.exit(1);
  }

  try {
    // Read and validate ticket
    const ticketJson = JSON.parse(readFileSync(ticketPath, "utf-8"));
    const ticket = validateTicket(ticketJson);

    // Read ZIP file
    const zipBuffer = readFileSync(zipPath);

    console.log(`\n${chalk.bold('Namespace:')}  ${ticket.namespace}`);
    console.log(`${chalk.bold('Date range:')} ${ticket.date_start} to ${ticket.date_end}`);
    console.log(`${chalk.bold('Owner:')}      ${chalk.dim(ticket.owner)}\n`);

    // Run verification
    const results = await verify(ticket, zipBuffer, {
      onProgress: (msg) => console.log(chalk.dim(`  ${msg}`)),
    });

    // Print results
    console.log("\n" + chalk.bold("═".repeat(50)));
    console.log(chalk.bold("  VERIFICATION RESULTS"));
    console.log(chalk.bold("═".repeat(50)) + "\n");

    const verifiedLine = `${chalk.green('✓')} Verified:     ${results.verified.length} logs`;
    const unnotarizedLine = results.unnotarized.length > 0
      ? `${chalk.yellow('⚠')} Unnotarized:  ${results.unnotarized.length} logs`
      : `${chalk.dim('○')} Unnotarized:  ${results.unnotarized.length} logs`;
    const missingLine = results.missing.length > 0
      ? `${chalk.red('✗')} Missing:      ${results.missing.length} logs`
      : `${chalk.dim('○')} Missing:      ${results.missing.length} logs`;

    console.log(verifiedLine);
    console.log(unnotarizedLine);
    console.log(missingLine);

    if (results.unnotarized.length === 0 && results.missing.length === 0) {
      console.log(chalk.green("\n✓ All logs matched.\n"));
      process.exit(0);
    }

    if (results.unnotarized.length > 0) {
      console.log(chalk.yellow("\n⚠ Unnotarized (in ZIP but not on Arweave):"));
      for (const hash of results.unnotarized.slice(0, 10)) {
        console.log(chalk.dim(`  ${hash}`));
      }
      if (results.unnotarized.length > 10) {
        console.log(chalk.dim(`  ... and ${results.unnotarized.length - 10} more`));
      }
    }

    if (results.missing.length > 0) {
      console.log(chalk.red("\n✗ Missing (on Arweave but not in ZIP):"));
      for (const tx of results.missing.slice(0, 10)) {
        console.log(chalk.dim(`  ${tx.hash}`));
        console.log(chalk.cyan(`    → ${getExplorerUrl(tx.txId)}`));
      }
      if (results.missing.length > 10) {
        console.log(chalk.dim(`  ... and ${results.missing.length - 10} more`));
      }
    }

    console.log("");
    process.exit(1);
  } catch (err) {
    console.error(chalk.red(`\nError: ${err instanceof Error ? err.message : err}`));
    process.exit(1);
  }
}

main();
