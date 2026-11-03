// Span selection ported from dsh-live-compact 1.0.1 index.js
// (selectNewestChunk). The DSH version walks a host session surface with a
// per-node token meter; here the same walk runs over plain entry records the
// extension builds from Pi's projected session entries. Pairing checks are
// re-expressed over tool-call ids because Pi has no toolPairingBalanced*
// helpers: a cut may not separate an assistant tool call from its result.

import { buildCard, MARK, RAIL_TOKENS, type Card } from "./plan.ts";

export const CHUNK_MIN = 1000;
export const CHUNK_MAX = RAIL_TOKENS;

export interface SpanEntry {
  id: string;
  role: string;
  text: string;
  tokens: number;
  toolCalls: string[];
  toolResultFor: string | null;
}

export interface Chunk {
  start: number;
  end: number;
  tokens: number;
  after: number;
  card: Card;
}

export function isCardEntry(entry: SpanEntry): boolean {
  return entry.text.includes(MARK);
}

// Cutting right after `end` is safe when no tool call issued at or before
// `end` inside the candidate span has its result after `end`.
function balancedAfter(entries: SpanEntry[], spanStart: number, end: number): boolean {
  const resultIndex = new Map<string, number>();
  entries.forEach((entry, i) => {
    if (entry.toolResultFor) resultIndex.set(entry.toolResultFor, i);
  });
  for (let i = spanStart; i <= end; i += 1) {
    for (const callId of entries[i].toolCalls) {
      const at = resultIndex.get(callId);
      if (at === undefined || at > end) return false;
    }
  }
  return true;
}

// A span may not start with a tool result whose call lives before the span.
function balancedBefore(entries: SpanEntry[], start: number): boolean {
  const first = entries[start];
  if (!first.toolResultFor) return true;
  const callAt = entries.findIndex((entry) => entry.toolCalls.includes(first.toolResultFor as string));
  return callAt >= start;
}

export function selectNewestChunk(entries: SpanEntry[]): Chunk | null {
  if (entries.length === 0) return null;
  const first = entries[0].role === "system" ? 1 : 0;
  let end = entries.length - 1;
  while (end >= first) {
    const entry = entries[end];
    const shortTail = entry.role === "assistant" || (entry.role === "user" && entry.tokens < 400);
    if (!shortTail) break;
    end -= 1;
  }
  while (end >= first && isCardEntry(entries[end])) end -= 1;
  while (end >= first && !balancedAfter(entries, first, end)) end -= 1;
  if (end < first || isCardEntry(entries[end])) return null;
  if (entries[end].tokens > CHUNK_MAX) return null;

  const spanText = (a: number, b: number) => entries.slice(a, b + 1).map((e) => e.text).join("\n");
  const liveText = (a: number, b: number) =>
    entries.filter((_, i) => i < a || i > b).map((e) => e.text).join("\n");

  let start = end;
  let tokens = entries[end].tokens;
  let card = buildCard(spanText(start, end), liveText(start, end));
  if (card.verdict !== "TRUNK CONFIRMED") return null;

  while (start > first) {
    const prev = start - 1;
    if (isCardEntry(entries[prev]) || entries[prev].role === "user") break;
    const nextTokens = tokens + entries[prev].tokens;
    if (nextTokens > CHUNK_MAX) break;
    const trial = buildCard(spanText(prev, end), liveText(prev, end));
    if (trial.verdict !== "TRUNK CONFIRMED") break;
    tokens = nextTokens;
    start = prev;
    card = trial;
  }

  while (start <= end && (isCardEntry(entries[start]) || !balancedBefore(entries, start))) {
    tokens -= entries[start].tokens;
    start += 1;
  }
  if (start > end || tokens < CHUNK_MIN || isCardEntry(entries[start])) return null;

  card = buildCard(spanText(start, end), liveText(start, end));
  if (card.verdict !== "TRUNK CONFIRMED") return null;
  if (!balancedAfter(entries, start, end)) return null;

  let after = 0;
  for (let i = end + 1; i < entries.length; i += 1) after += entries[i].tokens;
  return { start, end, tokens, after, card };
}
