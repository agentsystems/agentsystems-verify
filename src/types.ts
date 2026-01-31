export interface ArweaveTicket {
  type: "arweave";
  owner: string;
  namespace: string;
  date_start: string;
  date_end: string;
}

export interface ArweaveTxDetails {
  txId: string;
  hash: string;
  notarizedAt: string;
  notarizedDateUtc: string;
  sessionId: string;
  sequence: number;
  blockHeight: number | null;
  blockTimestamp: number | null;
  confirmations: number;
}

export interface VerificationResults {
  verified: ArweaveTxDetails[];
  unnotarized: string[];
  missing: ArweaveTxDetails[];
}
