// Live Compact for Pi — a faithful port of dsh-live-compact 1.0.6
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

import { backgroundJobId, backupHint, callCommand, callFilePath, estimateTokens } from "./plan.ts";
import { selectNewestChunk, type CallInfo, type SpanEntry } from "./select.ts";

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
    const tailBeyondKept = chunk.after - (chunk.keptTokens || 0);
    if (tailBeyondKept > MAX_TAIL && total < URGENT_TOKENS) return;

    const span = entries.slice(chunk.start, chunk.end + 1);
    const cardText =
      `${chunk.card.text}\n` +
      (chunk.card.needsBackup ? `${backupHint()}\n` : "") +
      `整段原文：本会话条目 ${span[0].id}..${span[span.length - 1].id}（原始条目保留在会话文件里）。`;
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
