// Live Compact for Pi — a faithful port of dsh-live-compact 1.0.1
// (MIT, MerkyorLynn) to Pi's extension boundary API.
//
// The DSH original hooks its host's compaction engine on agent idle and
// replaces the newest finished chunk with a locally built extractive card.
// Pi has no surface-replace compaction, but its turn_end boundary accepts
// context_edit drafts with exactly that effect: the first entry of the span
// is replaced by the card, the rest are omitted, and the raw entries stay in
// the session file (so Pi needs no shadow directory — see PORTING.md).
//
// No model is called and no tool is added, exactly like the original's
// spine cuts. When the card gate refuses (prose-heavy span), nothing is cut
// and Pi's own compaction remains in charge, mirroring the original's
// "wait-80" route.

import { estimateTokens } from "./plan.ts";
import { selectNewestChunk, type SpanEntry } from "./select.ts";

const BIG_GATE = 650000;
const URGENT_TOKENS = 48000;
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
  return content.map(blockText).join("\n");
}

function toSpanEntries(projected: any[]): SpanEntry[] {
  const entries: SpanEntry[] = [];
  for (const item of projected) {
    const messages = item?.messages ?? [];
    if (messages.length === 0) continue;
    const message = messages[0];
    const content = Array.isArray(message?.content) ? message.content : [];
    const toolCalls = content
      .filter((b: any) => b?.type === "toolCall" && typeof b.id === "string")
      .map((b: any) => b.id as string);
    const text = messages.map(messageText).join("\n");
    entries.push({
      id: item.sourceEntry.id,
      role: typeof message?.role === "string" ? message.role : "custom",
      text,
      tokens: estimateTokens(text),
      toolCalls,
      toolResultFor: message?.role === "toolResult" && typeof message.toolCallId === "string" ? message.toolCallId : null,
    });
  }
  return entries;
}

export default function liveCompact(pi: any) {
  pi.on("turn_end", async (event: any, ctx: any) => {
    const usage = ctx.getContextUsage?.();
    const projected = event.context?.contextEntries ?? [];
    const entries = toSpanEntries(projected);
    const total = typeof usage?.tokens === "number" ? usage.tokens : entries.reduce((sum, e) => sum + e.tokens, 0);
    if (total < MIN_PRESSURE || total >= BIG_GATE) return;

    const chunk = selectNewestChunk(entries);
    if (!chunk) return;
    if (chunk.after > MAX_TAIL && total < URGENT_TOKENS) return;

    const span = entries.slice(chunk.start, chunk.end + 1);
    const cardText =
      `${chunk.card.text}\n` +
      `Full shadowed text: session entries ${span[0].id}..${span[span.length - 1].id} ` +
      `(raw entries are retained in this session file).`;
    if (estimateTokens(cardText) >= chunk.tokens) return;

    const started = Date.now();
    const drafts = span.map((entry, i) =>
      i === 0
        ? { type: "context_edit", targetId: entry.id, replacement: { content: [{ type: "text", text: cardText }] } }
        : { type: "context_edit", targetId: entry.id, replacement: null },
    );
    ctx.ui?.notify?.(`spine cut ${Date.now() - started}ms total=${total} chunk=${chunk.tokens}`, "info");
    return { entries: drafts };
  });
}
