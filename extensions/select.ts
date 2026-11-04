// Span selection ported from dsh-live-compact 1.0.6 index.js
// (selectNewestChunk). The DSH version walks a host session surface with a
// per-node token meter; here the same walk runs over plain entry records the
// extension builds from Pi's projected session entries. Pairing checks are
// re-expressed over tool-call ids because Pi has no toolPairingBalanced*
// helpers: a cut may not separate an assistant tool call from its result.
// 1.0.6 addition: the newest finished tool rounds (default 3, within a
// token budget) are reserved — the cut must end before they start.

import {
  buildCard,
  chooseKeptSpan,
  keptToolRounds,
  MARK,
  RAIL_TOKENS,
  reservedCutEnd,
  type Card,
  type CardSpan,
  type RoundEvent,
} from "./plan.ts";

export const CHUNK_MIN = 1000;
export const CHUNK_MAX = RAIL_TOKENS;
export const KEEP_ROUNDS = Number(process.env.SPINE_KEEP_ROUNDS || 3);
export const KEEP_ROUND_TOKENS = Number(process.env.SPINE_KEEP_ROUND_TOKENS || 32000);

export interface CallInfo {
  id: string;
  name: string;
  command: string;
  filePath: string;
}

export interface SpanEntry {
  id: string;
  role: string;
  text: string;
  tokens: number;
  toolCalls: string[];
  toolResultFor: string | null;
  isError?: boolean;
  turn?: number | null;
  call?: CallInfo | null;
  backgroundStart?: boolean;
}

export interface Chunk {
  start: number;
  end: number;
  tokens: number;
  after: number;
  keptTokens: number;
  card: Card;
}

export function isCardEntry(entry: SpanEntry): boolean {
  return entry.text.includes(MARK);
}

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

function balancedBefore(entries: SpanEntry[], start: number): boolean {
  const first = entries[start];
  if (!first.toolResultFor) return true;
  const callAt = entries.findIndex((entry) => entry.toolCalls.includes(first.toolResultFor as string));
  return callAt >= start;
}

function toCardSpan(entry: SpanEntry): CardSpan {
  return {
    role: entry.role,
    text: entry.text,
    isError: entry.isError,
    command: entry.call?.command || "",
    name: entry.call?.name || "",
    filePath: entry.call?.filePath || "",
    toolCallId: entry.toolResultFor || undefined,
    turn: entry.turn ?? null,
    backgroundStart: entry.backgroundStart,
    entryId: entry.id,
  };
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

  // Reserve the newest finished tool rounds: the cut ends before them.
  const visible: (RoundEvent & { index: number })[] = [];
  for (let index = first; index <= end; index += 1) {
    visible.push({
      index,
      type: entries[index].role === "toolResult" ? "tool" : "other",
      toolCalls: entries[index].toolCalls.length,
    });
  }
  const rounds = keptToolRounds(visible, KEEP_ROUNDS);
  const span = chooseKeptSpan(rounds, (from, to) => {
    let tokens = 0;
    for (let index = visible[from.start].index; index <= visible[to.end].index; index += 1) tokens += entries[index].tokens;
    return tokens;
  }, KEEP_ROUND_TOKENS);
  const cutEnd = span ? reservedCutEnd(visible[span.start].index, first) : null;
  if (span && cutEnd === null) return null;
  let keptTokens = 0;
  if (cutEnd !== null && span) {
    for (let index = visible[span.start].index; index <= visible[span.end].index; index += 1) keptTokens += entries[index].tokens;
    end = cutEnd;
    while (end >= first && (isCardEntry(entries[end]) || entries[end].role === "user")) end -= 1;
    while (end >= first && !balancedAfter(entries, first, end)) end -= 1;
  }

  if (end < first || isCardEntry(entries[end])) return null;
  if (entries[end].tokens > CHUNK_MAX) return null;

  const spanText = (a: number, b: number) => entries.slice(a, b + 1).map((e) => e.text).join("\n");
  const liveText = (a: number, b: number) =>
    entries.filter((_, i) => i < a || i > b).map((e) => e.text).join("\n");
  const spanObjs = (a: number, b: number) => entries.slice(a, b + 1).map(toCardSpan);

  let start = end;
  let tokens = entries[end].tokens;
  let card = buildCard(spanText(start, end), liveText(start, end), spanObjs(start, end));
  if (!card.ok) return null;

  while (start > first) {
    const prev = start - 1;
    if (isCardEntry(entries[prev]) || entries[prev].role === "user") break;
    const nextTokens = tokens + entries[prev].tokens;
    if (nextTokens > CHUNK_MAX) break;
    const trial = buildCard(spanText(prev, end), liveText(prev, end), spanObjs(prev, end));
    if (!trial.ok) break;
    tokens = nextTokens;
    start = prev;
    card = trial;
  }

  while (start <= end && (isCardEntry(entries[start]) || !balancedBefore(entries, start))) {
    tokens -= entries[start].tokens;
    start += 1;
  }
  if (start > end || tokens < CHUNK_MIN || isCardEntry(entries[start])) return null;

  card = buildCard(spanText(start, end), liveText(start, end), spanObjs(start, end));
  if (!card.ok) return null;
  if (!balancedAfter(entries, start, end)) return null;

  let after = 0;
  for (let i = end + 1; i < entries.length; i += 1) after += entries[i].tokens;
  return { start, end, tokens, after, keptTokens, card };
}
