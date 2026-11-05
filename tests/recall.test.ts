import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RecallStore, recallHint, recallResult } from "../extensions/recall.ts";

const item = (id: string, text: string, label = `read "${id}.txt"`) => ({ id, label, text });

test("store put/get roundtrip and dedupe by id", () => {
  const store = new RecallStore();
  store.put(item("aaaa0001", "hello"));
  store.put(item("aaaa0001", "changed"));
  assert.equal(store.get("aaaa0001")?.text, "hello");
  assert.equal(store.get("missing"), undefined);
  assert.equal(store.size, 1);
});

test("bind persists to the sidecar and a fresh store reloads it", () => {
  const dir = mkdtempSync(join(tmpdir(), "spine-recall-"));
  const sessionFile = join(dir, "session.jsonl");
  const first = new RecallStore();
  first.bind(sessionFile);
  first.put(item("bbbb0002", "persisted body"));
  const second = new RecallStore();
  second.bind(sessionFile);
  assert.equal(second.get("bbbb0002")?.text, "persisted body");
  assert.equal(second.get("bbbb0002")?.label, 'read "bbbb0002.txt"');
});

test("bind tolerates a torn last sidecar line", () => {
  const dir = mkdtempSync(join(tmpdir(), "spine-recall-"));
  const sessionFile = join(dir, "session.jsonl");
  const first = new RecallStore();
  first.bind(sessionFile);
  first.put(item("cccc0003", "good line"));
  // Simulate a crash mid-append.
  appendFileSync(`${sessionFile}.spine.jsonl`, '{"id":"torn"');
  const second = new RecallStore();
  second.bind(sessionFile);
  assert.equal(second.get("cccc0003")?.text, "good line");
});

test("recallHint names the tool call and the ref for each item", () => {
  const hint = recallHint([item("dddd0004", "x"), item("eeee0005", "y")]);
  assert.match(hint, /spine_recall\("dddd0004"\)/);
  assert.match(hint, /spine_recall\("eeee0005"\)/);
  assert.match(hint, /不要重新读取源文件/);
});

test("recallResult returns small originals inline", () => {
  const store = new RecallStore();
  store.put(item("ffff0006", "small body"));
  const result = recallResult(store, "ffff0006");
  assert.equal(result.found, true);
  assert.match(result.text, /small body/);
});

test("recallResult writes large originals to a file with a preview", () => {
  const dir = mkdtempSync(join(tmpdir(), "spine-recall-"));
  const store = new RecallStore();
  store.bind(join(dir, "session.jsonl"));
  const big = `HEAD${"z".repeat(30000)}`;
  store.put(item("aaaa0007", big));
  const result = recallResult(store, "aaaa0007");
  assert.equal(result.found, true);
  const match = result.text.match(/已写入 (\S+)，/);
  assert.ok(match, "result names the dump path");
  assert.equal(readFileSync(match[1], "utf8"), big);
});

test("recallResult for an unknown ref lists what is available", () => {
  const store = new RecallStore();
  store.put(item("bbbb0008", "body"));
  const result = recallResult(store, "nope");
  assert.equal(result.found, false);
  assert.match(result.text, /bbbb0008/);
});
