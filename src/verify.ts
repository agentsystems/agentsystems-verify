import JSZip from "jszip";
import type { ArweaveTicket, ArweaveTxDetails, VerificationResults } from "./types.js";
import { generateDateRange, queryArweaveTransactions, getCurrentBlockHeight } from "./arweave.js";
import { hashContent } from "./hash.js";

export interface VerifyOptions {
  onProgress?: (message: string) => void;
}

export function validateTicket(json: Record<string, unknown>): ArweaveTicket {
  if (json.type !== "arweave") {
    throw new Error("Invalid ticket: type must be 'arweave'");
  }
  if (!json.owner || typeof json.owner !== "string") {
    throw new Error("Invalid ticket: missing or invalid 'owner' address");
  }
  if (!json.namespace || typeof json.namespace !== "string") {
    throw new Error("Invalid ticket: missing or invalid 'namespace'");
  }
  if (!json.date_start || typeof json.date_start !== "string") {
    throw new Error("Invalid ticket: missing or invalid 'date_start'");
  }
  if (!json.date_end || typeof json.date_end !== "string") {
    throw new Error("Invalid ticket: missing or invalid 'date_end'");
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(json.date_start)) {
    throw new Error("Invalid ticket: date_start must be YYYY-MM-DD format");
  }
  if (!dateRegex.test(json.date_end)) {
    throw new Error("Invalid ticket: date_end must be YYYY-MM-DD format");
  }

  if (json.date_start > json.date_end) {
    throw new Error("Invalid ticket: date_start must be before date_end");
  }

  return {
    type: "arweave",
    owner: json.owner,
    namespace: json.namespace,
    date_start: json.date_start,
    date_end: json.date_end,
  };
}

async function processZipAndHash(
  zipBuffer: Buffer,
  dateStart: string,
  dateEnd: string,
  onProgress?: (message: string) => void
): Promise<string[]> {
  const zip = await JSZip.loadAsync(zipBuffer);

  const allPaths = Object.keys(zip.files);
  const datePattern = /(\d{4})\/(\d{2})\/(\d{2})\/[^/]+\.json$/;
  const matchingPaths = allPaths.filter((p) => datePattern.test(p));

  if (matchingPaths.length === 0) {
    throw new Error(
      "No log files found in ZIP. Expected structure: {folder}/YYYY/MM/DD/{hash}.json"
    );
  }

  const filesToProcess: { path: string; entry: JSZip.JSZipObject }[] = [];

  for (const path of matchingPaths) {
    const zipEntry = zip.files[path];
    if (zipEntry.dir) continue;

    const match = path.match(datePattern);
    if (match) {
      const datePath = `${match[1]}-${match[2]}-${match[3]}`;
      if (datePath >= dateStart && datePath <= dateEnd) {
        filesToProcess.push({ path, entry: zipEntry });
      }
    }
  }

  if (filesToProcess.length === 0) {
    throw new Error(`No log files found within date range ${dateStart} to ${dateEnd}`);
  }

  onProgress?.(`Found ${filesToProcess.length} files. Hashing...`);

  const computedHashes: string[] = [];

  for (let i = 0; i < filesToProcess.length; i++) {
    const { entry } = filesToProcess[i];

    if (i % 50 === 0 && i > 0) {
      onProgress?.(`Hashed ${i}/${filesToProcess.length} files...`);
    }

    const content = await entry.async("string");
    const hash = hashContent(content);
    computedHashes.push(hash);
  }

  return computedHashes;
}

export async function verify(
  ticket: ArweaveTicket,
  zipBuffer: Buffer,
  options: VerifyOptions = {}
): Promise<VerificationResults> {
  const { onProgress } = options;

  onProgress?.("Reading ZIP file...");

  const localHashes = await processZipAndHash(
    zipBuffer,
    ticket.date_start,
    ticket.date_end,
    onProgress
  );
  const localHashSet = new Set(localHashes);

  onProgress?.(`Hashed ${localHashes.length} files. Querying Arweave...`);

  const dates = generateDateRange(ticket.date_start, ticket.date_end);
  const arweaveTxs = await queryArweaveTransactions(
    ticket.owner,
    ticket.namespace,
    dates,
    (page, count) => {
      onProgress?.(`Fetching page ${page} from Arweave (${count} transactions)...`);
    }
  );

  onProgress?.(`Found ${arweaveTxs.length} transactions. Calculating confirmations...`);

  const currentHeight = await getCurrentBlockHeight();

  const arweaveMap = new Map<string, ArweaveTxDetails>();
  for (const tx of arweaveTxs) {
    tx.confirmations = tx.blockHeight ? currentHeight - tx.blockHeight : 0;
    arweaveMap.set(tx.hash, tx);
  }

  onProgress?.("Reconciling results...");

  const verified: ArweaveTxDetails[] = [];
  const unnotarized: string[] = [];
  const missing: ArweaveTxDetails[] = [];

  for (const hash of localHashes) {
    const tx = arweaveMap.get(hash);
    if (tx) {
      verified.push(tx);
    } else {
      unnotarized.push(hash);
    }
  }

  for (const tx of arweaveTxs) {
    if (!localHashSet.has(tx.hash)) {
      missing.push(tx);
    }
  }

  return { verified, unnotarized, missing };
}
