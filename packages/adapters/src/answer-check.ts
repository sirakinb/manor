import type { AnswerCheckRequest } from "@rakazo/adapter-kit";
import { redactSecrets } from "@rakazo/core";
import { redactForReview } from "./auto-review.js";

const MIN_CLAIM_WORDS = 4;
const MAX_CLAIMS = 20;
const MAX_CLAIM_CHARS = 400;
const MAX_SOURCES = 30;
const MAX_SOURCE_CHARS = 4_000;

/**
 * Split a reply into checkable statements. Code, questions, and fragments are skipped because
 * they make no factual claim; both engines check the same list so verdicts line up.
 */
export function extractClaims(reply: string): string[] {
  const prose = reply
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~]+/g, "");
  const claims = new Set<string>();
  for (const line of prose.split("\n")) {
    const text = line.replace(/^\s*(?:[-*+>]|\d+[.)]|#{1,6})\s+/, "").trim();
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const claim = sentence.trim();
      if (claim.endsWith("?")) continue;
      if (claim.split(/\s+/).length < MIN_CLAIM_WORDS) continue;
      claims.add(claim.slice(0, MAX_CLAIM_CHARS));
      if (claims.size >= MAX_CLAIMS) return [...claims];
    }
  }
  return [...claims];
}

/** Collects redacted tool results for this attempt, bounded in count and size. */
export class AnswerSources {
  readonly items: AnswerCheckRequest["sources"] = [];

  add(tool: string, result: unknown, secrets: string[]) {
    if (this.items.length >= MAX_SOURCES || result == null) return;
    let content: string;
    try {
      const redacted = redactForReview(parseJsonText(result), secrets);
      content = typeof redacted === "string" ? redacted : JSON.stringify(redacted);
    } catch {
      return;
    }
    content = redactSecrets(content, secrets)
      .replace(/data:[\w/+.-]+;base64,[A-Za-z0-9+/=]{64,}/g, "[binary]")
      .slice(0, MAX_SOURCE_CHARS)
      .trim();
    if (content) this.items.push({ tool, content });
  }
}

/** Tools often return JSON as text; parse it so sensitive keys inside are redacted too. */
function parseJsonText(result: unknown): unknown {
  if (typeof result !== "string" || !/^\s*[[{]/.test(result)) return result;
  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
}
