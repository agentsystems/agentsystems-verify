import type { ArweaveTxDetails } from "./types.js";

const ARWEAVE_GRAPHQL = "https://arweave.net/graphql";
const ARWEAVE_INFO = "https://arweave.net/info";

export function generateDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  const current = new Date(start);

  while (current <= end) {
    dates.push(current.toISOString().split("T")[0]);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

export async function queryArweaveTransactions(
  owner: string,
  namespace: string,
  dates: string[],
  onProgress?: (page: number, count: number) => void
): Promise<ArweaveTxDetails[]> {
  const results: ArweaveTxDetails[] = [];
  let cursor: string | null = null;
  let page = 1;

  const datesStr = dates.map((d) => `"${d}"`).join(", ");

  while (true) {
    const afterClause: string = cursor ? `, after: "${cursor}"` : "";

    const query: string = `{
      transactions(
        tags: [
          {name: "App-Name", values: ["agentsystems-notary"]},
          {name: "Namespace", values: ["${namespace}"]},
          {name: "Notarized-Date-UTC", values: [${datesStr}]}
        ],
        owners: ["${owner}"],
        first: 100${afterClause},
        sort: HEIGHT_DESC
      ) {
        pageInfo { hasNextPage }
        edges {
          cursor
          node {
            id
            block { timestamp height }
            tags { name value }
          }
        }
      }
    }`;

    const response = await fetch(ARWEAVE_GRAPHQL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`Arweave query failed: ${response.statusText}`);
    }

    const data = await response.json() as {
      errors?: Array<{ message: string }>;
      data?: {
        transactions?: {
          pageInfo?: { hasNextPage: boolean };
          edges?: Array<{
            cursor: string;
            node: {
              id: string;
              block?: { timestamp: number; height: number };
              tags: Array<{ name: string; value: string }>;
            };
          }>;
        };
      };
    };

    if (data.errors) {
      throw new Error(`Arweave GraphQL error: ${data.errors[0]?.message}`);
    }

    const transactions = data.data?.transactions;
    const edges = transactions?.edges || [];
    const hasNext: boolean = transactions?.pageInfo?.hasNextPage || false;

    for (const edge of edges) {
      const node = edge.node;
      const tags = Object.fromEntries(
        node.tags.map((t) => [t.name, t.value])
      );

      results.push({
        txId: node.id,
        hash: tags["Hash"] || "",
        notarizedAt: tags["Notarized-At"] || "",
        notarizedDateUtc: tags["Notarized-Date-UTC"] || "",
        sessionId: tags["Session-ID"] || "",
        sequence: parseInt(tags["Sequence"] || "0"),
        blockHeight: node.block?.height || null,
        blockTimestamp: node.block?.timestamp || null,
        confirmations: 0,
      });
    }

    onProgress?.(page, results.length);

    if (!hasNext || edges.length === 0) break;
    cursor = edges[edges.length - 1].cursor;
    page++;
  }

  return results;
}

export async function getCurrentBlockHeight(): Promise<number> {
  const response = await fetch(ARWEAVE_INFO);
  if (!response.ok) {
    throw new Error(`Failed to get Arweave network info: ${response.statusText}`);
  }
  const data = await response.json() as { height?: number };
  return data.height || 0;
}

export function getExplorerUrl(txId: string): string {
  return `https://arscan.io/tx/${txId}`;
}
