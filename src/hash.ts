import { createHash } from "crypto";
import canonicalizeModule from "canonicalize";

const canonicalize = canonicalizeModule as unknown as (input: unknown) => string | undefined;

export function hashContent(content: string): string {
  const parsed = JSON.parse(content);
  const canonical = canonicalize(parsed);
  if (!canonical) {
    throw new Error("Failed to canonicalize JSON");
  }
  return createHash("sha256").update(canonical).digest("hex");
}
