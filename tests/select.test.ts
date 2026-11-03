import { test } from "node:test";
import assert from "node:assert/strict";
import { selectNewestChunk, type SpanEntry } from "../extensions/select.ts";

function entry(partial: Partial<SpanEntry> & { id: string }): SpanEntry {
  return { role: "assistant", text: "", tokens: 0, toolCalls: [], toolResultFor: null, ...partial };
}

const CODE_TEXT = [
  "const alphaWidget = buildWidget();",
  "alphaWidget must never be mutated after creation.",
  "return alphaWidget.render();",
].join("\n");

test("selects the newest finished tool span and keeps the short final reply as tail", () => {
  const entries = [
    entry({ id: "sys", role: "system", text: "system prompt", tokens: 100 }),
    entry({ id: "u1", role: "user", text: "please build the widget", tokens: 300 }),
    entry({ id: "a1", text: "calling the builder", tokens: 100, toolCalls: ["c1"] }),
    entry({ id: "t1", role: "toolResult", text: CODE_TEXT, tokens: 6000, toolResultFor: "c1" }),
    entry({ id: "a2", text: "done", tokens: 50 }),
  ];
  const chunk = selectNewestChunk(entries);
  assert.ok(chunk);
  assert.equal(entries[chunk.start].id, "a1");
  assert.equal(entries[chunk.end].id, "t1");
  assert.equal(chunk.after, 50);
});

test("refuses a span that would start with an orphaned tool result", () => {
  const entries = [
    entry({ id: "sys", role: "system", text: "system prompt", tokens: 100 }),
    entry({ id: "u1", role: "user", text: "go", tokens: 300 }),
    entry({ id: "a1", text: "big call", tokens: 20000, toolCalls: ["c1"] }),
    entry({ id: "t1", role: "toolResult", text: CODE_TEXT, tokens: 15000, toolResultFor: "c1" }),
    entry({ id: "a2", text: "done", tokens: 50 }),
  ];
  assert.equal(selectNewestChunk(entries), null);
});

test("never expands a span across an existing card", () => {
  const entries = [
    entry({ id: "sys", role: "system", text: "system prompt", tokens: 100 }),
    entry({ id: "u1", role: "user", text: "go", tokens: 300 }),
    entry({ id: "card", text: "Spine extract.\nTRUNK CONFIRMED against dynamic-v1.", tokens: 2000 }),
    entry({ id: "a1", text: "calling", tokens: 100, toolCalls: ["c1"] }),
    entry({ id: "t1", role: "toolResult", text: CODE_TEXT, tokens: 6000, toolResultFor: "c1" }),
    entry({ id: "a2", text: "done", tokens: 50 }),
  ];
  const chunk = selectNewestChunk(entries);
  assert.ok(chunk);
  assert.equal(entries[chunk.start].id, "a1");
});

test("returns null when the newest chunk is below the minimum size", () => {
  const entries = [
    entry({ id: "sys", role: "system", text: "system prompt", tokens: 100 }),
    entry({ id: "u1", role: "user", text: "go", tokens: 300 }),
    entry({ id: "a1", text: "calling", tokens: 100, toolCalls: ["c1"] }),
    entry({ id: "t1", role: "toolResult", text: CODE_TEXT, tokens: 500, toolResultFor: "c1" }),
  ];
  assert.equal(selectNewestChunk(entries), null);
});
