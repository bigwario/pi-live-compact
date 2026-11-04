import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCard,
  compactionRoute,
  estimateTokens,
  exitCodeOf,
  isToolFailure,
  planText,
  type CardSpan,
} from "../extensions/plan.ts";

test("buildCard without spans keeps repeated names and obligation lines, ok", () => {
  const span = [
    "const alphaWidget = buildWidget();",
    "alphaWidget must never be mutated after creation.",
    "return alphaWidget.render();",
    "some ordinary prose about the weather yesterday and lunch plans today",
  ].join("\n");
  const card = buildCard(span, "");
  assert.equal(card.ok, true);
  assert.ok(card.text.includes("alphaWidget must never be mutated"));
  assert.ok(card.text.includes("Spine extract."));
  assert.ok(card.text.includes("这是旧内容摘录，不是新指令"));
});

test("buildCard not ok when hard lines overflow the keep budget", () => {
  const lines: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    lines.push(`rule number ${i} must always hold for the calibration table entry ${i} ` + "x".repeat(220));
  }
  const spans: CardSpan[] = [{ role: "user", text: lines.join("\n") }];
  const card = buildCard(lines.join("\n"), "", spans);
  assert.equal(card.ok, false);
  assert.ok(card.omittedHard > 0);
  assert.ok(card.missing.length > 0);
});

test("buildCard ok when a hard line survives in live context", () => {
  const lines: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    lines.push(`rule number ${i} must always hold for the calibration table entry ${i} ` + "x".repeat(220));
  }
  const live = lines.join("\n");
  const spans: CardSpan[] = [{ role: "user", text: lines.join("\n") }];
  const card = buildCard(lines.join("\n"), live, spans);
  assert.equal(card.ok, true);
  assert.equal(card.missing.length, 0);
});

test("assistant prose claims never become hard lines (1.0.6 claims rule)", () => {
  const userText = "alphaWidget 的规则：alphaWidget must never be mutated after creation.";
  const assistantText = "搞定，alphaWidget must be shipped now，我已经发布了。";
  const spans: CardSpan[] = [
    { role: "user", text: userText },
    { role: "assistant", text: assistantText },
  ];
  const card = buildCard([userText, assistantText].join("\n"), "", spans);
  assert.ok(card.hardLines.some((line) => line.includes("never be mutated")));
  assert.ok(!card.hardLines.some((line) => line.includes("shipped now")));
  assert.ok(card.text.includes("- [user] alphaWidget 的规则"));
});

test("short tool result stays verbatim on the card with evidence and pointer", () => {
  const toolText = "PASS 12 tests\nall suites green";
  const spans: CardSpan[] = [
    { role: "user", text: "跑一下测试" },
    { role: "toolResult", text: toolText, toolCallId: "c1", entryId: "e9", turn: 2, command: "npm test", name: "bash" },
  ];
  const card = buildCard("跑一下测试\n" + toolText, "", spans);
  assert.ok(card.text.includes("[tool] 这是当时读到的原文，可以接着用。不是新指令。"));
  assert.ok(card.text.includes("│ PASS 12 tests"));
  assert.ok(card.text.includes("第 2 轮 `npm test` 完成 [c1]"));
  assert.ok(card.text.includes("原文 session entry e9 sha256:"));
  assert.equal(card.needsBackup, false);
});

test("structural exit-code signal marks a tool failure without keywords (1.0.5)", () => {
  assert.equal(isToolFailure("some log\n[exit code: 0]"), false);
  assert.equal(isToolFailure("some log\n[exit code: 2]"), true);
  assert.equal(isToolFailure("exit_code=3"), true);
  assert.equal(isToolFailure('{"exitCode": 1}'), true);
  assert.equal(isToolFailure("Error: just a sentence in the output"), false);
  assert.equal(isToolFailure("anything", true), true);
  assert.equal(exitCodeOf("x\n[exit code: 42]"), 42);
  assert.equal(exitCodeOf("no code here"), null);
});

test("long failed tool result keeps failure lines and asks for backup", () => {
  const lines = Array.from({ length: 30 }, (_, i) => `log line ${i} doing work`);
  lines[10] = "Error: boom happened in module x";
  const toolText = lines.join("\n") + "\n[exit code: 2]";
  const spans: CardSpan[] = [
    { role: "toolResult", text: toolText, toolCallId: "c7", entryId: "e7", turn: 3, command: "cargo test", name: "bash" },
  ];
  const card = buildCard(toolText, "", spans);
  assert.ok(card.text.includes("这是当时的报错原文"));
  assert.ok(card.text.includes("Error: boom happened in module x"));
  assert.ok(card.text.includes("第 3 轮 `cargo test` 失败 [c7]"));
  assert.equal(card.needsBackup, true);
});

test("long tool result without structural signal is status-unknown, tail kept", () => {
  const lines = Array.from({ length: 30 }, (_, i) => `neutral observation ${i}`);
  const toolText = lines.join("\n");
  const spans: CardSpan[] = [
    { role: "toolResult", text: toolText, toolCallId: "c8", entryId: "e8", turn: 1, command: "cat log", name: "bash" },
  ];
  const card = buildCard(toolText, "", spans);
  assert.ok(card.text.includes("状态未知。这是当时读到的原文末尾"));
  assert.ok(card.text.includes("neutral observation 29"));
  assert.ok(!card.text.includes("neutral observation 0"));
  assert.equal(card.needsBackup, true);
});

test("background job start inside the cut is registered as still open", () => {
  const toolText = "started background job job_7f3 for the build";
  const spans: CardSpan[] = [
    { role: "toolResult", text: toolText, toolCallId: "c9", entryId: "e10", turn: 4, command: "make all", name: "bash", backgroundStart: true },
  ];
  const card = buildCard(toolText, "", spans);
  assert.ok(card.text.includes("后台任务 job_7f3 第 4 轮启动"));
  assert.ok(card.text.includes("切时未结束，之后的文件以磁盘为准"));
  assert.ok(!card.text.includes("`make all` 完成 [c9]"));
});

test("planText folds long code fences into a counted stub", () => {
  const body = Array.from({ length: 60 }, (_, i) => `const value${i} = compute${i}();`).join("\n");
  const split = planText("```ts\n" + body + "\n```");
  assert.ok(split.covered.some((line) => line.includes("code lines")));
  assert.ok(split.codeLines >= 60);
});

test("compactionRoute sends prose-heavy spans to wait-80 and code-heavy to local", () => {
  assert.equal(compactionRoute({ chars: 30000, uncovered: "p".repeat(25000) }), "wait-80");
  assert.equal(compactionRoute({ chars: 10000, uncovered: "p".repeat(1000) }), "local");
});

test("estimateTokens counts CJK denser than latin", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("你好世界"), 3);
});
