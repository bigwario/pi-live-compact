// Live Compact for Pi — a faithful port of dsh-live-compact 1.0.8
// (MIT, MerkyorLynn) to Pi's extension boundary API.
//
// The DSH original hooks its host's compaction engine on agent idle and
// replaces the newest finished chunk with a locally built extractive card.
// Pi has no surface-replace compaction, but its turn_end boundary accepts
// context_edit drafts with exactly that effect: the first entry of the span
// is replaced by the card, the rest are omitted, and the raw entries stay in
// the session file (so Pi needs no shadow directory — see PORTING.md).
//
// 1.0.7/1.0.8 behaviour carried over: selection splits by engine (local
// endpoints cut like the original; cloud endpoints only pointerise
// oversized results until the total plus predicted growth passes the keep
// budget, then drain turn-segment by turn-segment), and upstream's
// multi-pass drain is folded into one turn_end by selecting against a
// simulated entry list and returning every pass's edits together.
//
// No model is called and no tool is added, exactly like the original's
// spine cuts. When the card gate refuses (prose-heavy span), nothing is cut
// and Pi's own compaction remains in charge, mirroring the original's
// "wait-80" route.

import {
  backgroundJobId,
  callCommand,
  callFilePath,
  estimateTokens,
  fallbackProviderURL,
  lookupProviderURL,
  resolveEngine,
} from "./plan.ts";
import { KEEP_ROUND_TOKENS, selectNewestChunk, URGENT_TOKENS, type CallInfo, type SpanEntry } from "./select.ts";

const BIG_GATE = 650000;
const MAX_TAIL = 2200;
const MIN_PRESSURE = Number(process.env.SPINE_MIN_TOKENS || 20000);

function blockText(block: any): string {
  if (!block || typeof block !== "object") return "";
  if (block.type === "text" && typeof block.text === "string") return block.text;
  return "";
}

function messageText(message: any): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(blockText).filter((part) => part.length > 0).join("\n");
}

function toSpanEntries(projected: any[]): SpanEntry[] {
  const entries: SpanEntry[] = [];
  const callIndex = new Map<string, CallInfo>();
  let turn: number | null = null;
  for (const item of projected) {
    const messages = item?.messages ?? [];
    if (messages.length === 0) continue;
    const message = messages[0];
    const role = typeof message?.role === "string" ? message.role : "custom";
    if (role === "user") turn = (turn ?? 0) + 1;
    const content = Array.isArray(message?.content) ? message.content : [];
    const toolCalls: string[] = [];
    for (const block of content) {
      if (block?.type === "toolCall" && typeof block.id === "string") {
        toolCalls.push(block.id);
        if (!callIndex.has(block.id)) {
          callIndex.set(block.id, {
            id: block.id,
            name: typeof block.name === "string" ? block.name : "",
            command: callCommand(typeof block.name === "string" ? block.name : "", block.arguments),
            filePath: callFilePath(block.arguments),
          });
        }
      }
    }
    const text = messages.map(messageText).join("\n");
    const toolResultFor = role === "toolResult" && typeof message.toolCallId === "string" ? message.toolCallId : null;
    entries.push({
      id: item.sourceEntry.id,
      role,
      text,
      tokens: estimateTokens(text),
      toolCalls,
      toolResultFor,
      isError: message?.isError === true,
      turn,
      call: toolResultFor ? callIndex.get(toolResultFor) || null : null,
      backgroundStart: toolResultFor ? Boolean(backgroundJobId(text)) : false,
      seq: entries.length,
    });
  }
  return entries;
}

// Engine identity from the session's model: provider name and base URL,
// with the registry as the lookup table, mirroring the host wiring in
// upstream index.js (requestHeader / requestContext / listProviders).
function engineFor(ctx: any): { engine: string; source: string } {
  let provider = "";
  let baseURL = "";
  try {
    provider = typeof ctx?.model?.provider === "string" ? ctx.model.provider : "";
    baseURL = typeof ctx?.model?.baseUrl === "string" ? ctx.model.baseUrl : "";
    if (!baseURL && provider) {
      const listed = (ctx?.modelRegistry?.getAll?.() || []).map((model: any) => ({
        provider: typeof model?.provider === "string" ? model.provider : "",
        id: typeof model?.provider === "string" ? model.provider : "",
        baseURL: typeof model?.baseUrl === "string" ? model.baseUrl : "",
      }));
      baseURL = lookupProviderURL(provider, listed);
    }
  } catch {
    // Resolution must never break a turn; fall through to the fallback.
  }
  if (!baseURL) baseURL = fallbackProviderURL(provider);
  return resolveEngine({ provider, baseURL, env: process.env });
}

export default function liveCompact(pi: any) {
  // Turn-growth bookkeeping for the cloud drain trigger. Pi runs one
  // process per invocation, so this resets between `pi -p` runs; the
  // urgent-line trigger inside selection does not depend on it.
  let turnBase: number | null = null;
  let maxTurnGrowth = 0;

  pi.on("turn_end", async (event: any, ctx: any) => {
    const usage = ctx.getContextUsage?.();
    const projected = event.context?.contextEntries ?? [];
    let work = toSpanEntries(projected);
    const hostTotal = typeof usage?.tokens === "number" ? usage.tokens : work.reduce((sum, e) => sum + e.tokens, 0);
    if (hostTotal < MIN_PRESSURE || hostTotal >= BIG_GATE) return;

    const { engine } = engineFor(ctx);
    const cloud = engine !== "local";
    const growth = Math.max(0, hostTotal - (turnBase ?? hostTotal));
    maxTurnGrowth = Math.max(maxTurnGrowth, growth);
    const drain = cloud && hostTotal + maxTurnGrowth > KEEP_ROUND_TOKENS;

    let simTotal = hostTotal;
    const drafts: any[] = [];
    let cuts = 0;
    for (let pass = 0; pass < 8; pass += 1) {
      if (drain && simTotal <= KEEP_ROUND_TOKENS) break;
      const chunk = selectNewestChunk(work, { engine, totalTokens: simTotal, drain });
      if (!chunk) break;
      const tailBeyondKept = chunk.after - (chunk.keptTokens || 0);
      if (!drain && tailBeyondKept > MAX_TAIL && simTotal < URGENT_TOKENS) break;
      const span = work.slice(chunk.start, chunk.end + 1);
      const cardText = chunk.card.text;
      const cardTokens = estimateTokens(cardText);
      if (cardTokens >= chunk.tokens) break;
      for (let i = 0; i < span.length; i += 1) {
        drafts.push(
          i === 0
            ? { type: "context_edit", targetId: span[i].id, replacement: { content: [{ type: "text", text: cardText }] } }
            : { type: "context_edit", targetId: span[i].id, replacement: null },
        );
      }
      const cardEntry: SpanEntry = {
        id: span[0].id,
        role: "assistant",
        text: cardText,
        tokens: cardTokens,
        toolCalls: [],
        toolResultFor: null,
        isError: false,
        turn: span[0].turn ?? null,
        call: null,
        backgroundStart: false,
        seq: span[0].seq,
      };
      work = [...work.slice(0, chunk.start), cardEntry, ...work.slice(chunk.end + 1)];
      simTotal -= chunk.tokens - cardTokens;
      cuts += 1;
      if (!drain) break;
    }
    turnBase = simTotal;
    if (cuts === 0) return;
    ctx.ui?.notify?.(`spine cut x${cuts} total=${hostTotal} -> ${simTotal}`, "info");
    return { entries: drafts };
  });
}
