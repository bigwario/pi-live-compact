import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// live-compact.ts imports "typebox", which Pi provides at runtime. Under a
// bare `node --test` it resolves only when node_modules/typebox is linked
// in (e.g. to Pi's bundled copy); otherwise these wiring tests skip.
let liveCompact: any = null;
try {
  liveCompact = (await import("../extensions/live-compact.ts")).default;
} catch {
  liveCompact = null;
}

// Handler-level wiring: drive the registered turn_end handler with fake
// projected entries. Local engine via a loopback baseUrl; usage is stubbed
// over the pressure line so selection is reached whenever cooldown lets it.

function makeExtension() {
  const handlers = new Map<string, Function>();
  const pi = {
    on: (name: string, fn: Function) => handlers.set(name, fn),
    registerTool: () => {},
  };
  liveCompact(pi);
  const dir = mkdtempSync(join(tmpdir(), "spine-handler-"));
  const ctx = {
    getContextUsage: () => ({ tokens: 30000 }),
    model: { provider: "test", baseUrl: "http://127.0.0.1:9" },
    modelRegistry: { getAll: () => [] },
    sessionManager: { getSessionFile: () => join(dir, "session.jsonl") },
    ui: { notify: () => {} },
  };
  return { turnEnd: handlers.get("turn_end") as Function, ctx };
}

function projected(compactionId: string | null) {
  const entries: any[] = [
    { sourceEntry: { id: "sys" }, messages: [{ role: "system", content: [{ type: "text", text: "system prompt" }] }] },
    { sourceEntry: { id: "u1" }, messages: [{ role: "user", content: [{ type: "text", text: "do the work" }] }] },
  ];
  if (compactionId) {
    entries.push({
      sourceEntry: { id: compactionId, type: "compaction", timestamp: "2026-11-06T00:00:00.000Z" },
      messages: [{ role: "compactionSummary", content: [{ type: "text", text: "official summary of earlier work" }] }],
    });
  }
  const body = Array.from({ length: 150 }, (_, i) => `filler line ${i} about the archive service and its daily snapshots`).join("\n");
  for (let round = 0; round < 4; round += 1) {
    entries.push({
      sourceEntry: { id: `a${round}` },
      messages: [{ role: "assistant", content: [{ type: "toolCall", id: `c${round}`, name: "bash", arguments: { command: "npm test" } }] }],
    });
    entries.push({
      sourceEntry: { id: `t${round}` },
      messages: [{ role: "toolResult", toolCallId: `c${round}`, content: [{ type: "text", text: body }] }],
    });
  }
  entries.push({ sourceEntry: { id: "aF" }, messages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }] });
  return { context: { contextEntries: entries } };
}

test("turn_end cuts on the first pass when no official compaction exists", async (t) => {
  if (!liveCompact) return t.skip("typebox not resolvable outside Pi");
  const { turnEnd, ctx } = makeExtension();
  const result = await turnEnd(projected(null), ctx);
  assert.ok(result?.entries?.length > 0);
});

test("a fresh official compaction makes exactly one pass yield, then cuts resume", async (t) => {
  if (!liveCompact) return t.skip("typebox not resolvable outside Pi");
  const { turnEnd, ctx } = makeExtension();
  const first = await turnEnd(projected("comp-1"), ctx);
  assert.equal(first, undefined);
  const second = await turnEnd(projected("comp-1"), ctx);
  assert.ok(second?.entries?.length > 0);
  const third = await turnEnd(projected("comp-2"), ctx);
  assert.equal(third, undefined);
  const fourth = await turnEnd(projected("comp-2"), ctx);
  assert.ok(fourth?.entries?.length > 0);
});
