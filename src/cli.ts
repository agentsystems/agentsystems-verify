#!/usr/bin/env node

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import chalk from "chalk";
import prompts from "prompts";
import { verify, validateTicket, getExplorerUrl } from "./index.js";
import type { ArweaveTicket } from "./types.js";

function getVersion(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
  return pkg.version;
}

function printUsage() {
  console.log(`
${chalk.bold('agentsystems-verify')} - Verify notarized logs against Arweave blockchain

${chalk.bold('Usage:')}
  agentsystems-verify --ticket <file> --logs <file>
  agentsystems-verify --owner <addr> --namespace <ns> --start <date> --end <date> --logs <file>
  agentsystems-verify --logs <file>  ${chalk.dim('(interactive mode)')}

${chalk.bold('Options:')}
  --ticket, -t      Arweave verification ticket (JSON file)
  --logs, -l        ZIP file containing log files to verify
  --owner, -o       Arweave wallet address
  --namespace, -n   Namespace identifier
  --start, -s       Start date (YYYY-MM-DD)
  --end, -e         End date (YYYY-MM-DD)
  --help, -h        Show this help message
  --version, -v     Show version number

${chalk.bold('Examples:')}
  ${chalk.dim('# Using a ticket file')}
  npx agentsystems-verify --ticket ticket.json --logs logs.zip

  ${chalk.dim('# Using CLI flags')}
  npx agentsystems-verify --owner 37LN... --namespace my_app --start 2026-01-01 --end 2026-01-31 --logs logs.zip

  ${chalk.dim('# Interactive mode')}
  npx agentsystems-verify --logs logs.zip

For more info: ${chalk.cyan('https://github.com/agentsystems/agentsystems-verify')}
`);
}

interface ParsedArgs {
  ticket: string | null;
  logs: string | null;
  owner: string | null;
  namespace: string | null;
  start: string | null;
  end: string | null;
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    ticket: null,
    logs: null,
    owner: null,
    namespace: null,
    start: null,
    end: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--ticket":
      case "-t":
        result.ticket = next || null;
        i++;
        break;
      case "--logs":
      case "-l":
        result.logs = next || null;
        i++;
        break;
      case "--owner":
      case "-o":
        result.owner = next || null;
        i++;
        break;
      case "--namespace":
      case "-n":
        result.namespace = next || null;
        i++;
        break;
      case "--start":
      case "-s":
        result.start = next || null;
        i++;
        break;
      case "--end":
      case "-e":
        result.end = next || null;
        i++;
        break;
    }
  }

  return result;
}

async function promptForMissing(args: ParsedArgs): Promise<Record<string, unknown>> {
  const questions: prompts.PromptObject[] = [];

  if (!args.owner) {
    questions.push({
      type: "text",
      name: "owner",
      message: "Arweave wallet address (owner):",
      validate: (v) => v.length > 0 || "Required",
    });
  }

  if (!args.namespace) {
    questions.push({
      type: "text",
      name: "namespace",
      message: "Namespace:",
      validate: (v) => v.length > 0 || "Required",
    });
  }

  if (!args.start) {
    questions.push({
      type: "text",
      name: "start",
      message: "Start date (YYYY-MM-DD):",
      validate: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) || "Use YYYY-MM-DD format",
    });
  }

  if (!args.end) {
    questions.push({
      type: "text",
      name: "end",
      message: "End date (YYYY-MM-DD):",
      validate: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) || "Use YYYY-MM-DD format",
    });
  }

  const answers = questions.length > 0 ? await prompts(questions) : {};

  // Check if user cancelled (Ctrl+C)
  if (questions.length > 0 && Object.keys(answers).length < questions.length) {
    console.log(chalk.dim("\nCancelled."));
    process.exit(0);
  }

  const owner = (args.owner || answers.owner || "").trim();
  const namespace = (args.namespace || answers.namespace || "").trim();
  const date_start = (args.start || answers.start || "").trim();
  const date_end = (args.end || answers.end || "").trim();

  return { type: "arweave", owner, namespace, date_start, date_end };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(`agentsystems-verify ${getVersion()}`);
    process.exit(0);
  }

  const parsed = parseArgs(args);

  // Require --logs
  if (!parsed.logs) {
    console.error(chalk.red("Error: --logs is required"));
    printUsage();
    process.exit(1);
  }

  // Check logs file exists
  if (!existsSync(parsed.logs)) {
    console.error(chalk.red(`Error: ZIP file not found: ${parsed.logs}`));
    process.exit(1);
  }

  let ticket: ArweaveTicket;

  try {
    if (parsed.ticket) {
      // Mode 1: Ticket file
      if (!existsSync(parsed.ticket)) {
        console.error(chalk.red(`Error: Ticket file not found: ${parsed.ticket}`));
        process.exit(1);
      }
      const ticketJson = JSON.parse(readFileSync(parsed.ticket, "utf-8"));
      ticket = validateTicket(ticketJson);
    } else if (parsed.owner && parsed.namespace && parsed.start && parsed.end) {
      // Mode 2: All CLI flags provided
      ticket = validateTicket({
        type: "arweave",
        owner: parsed.owner,
        namespace: parsed.namespace,
        date_start: parsed.start,
        date_end: parsed.end,
      });
    } else {
      // Mode 3: Interactive - prompt for missing values
      console.log(chalk.dim("\nEnter verification details:\n"));
      const prompted = await promptForMissing(parsed);
      ticket = validateTicket(prompted);
    }

    // Read ZIP file
    const zipBuffer = readFileSync(parsed.logs);

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
