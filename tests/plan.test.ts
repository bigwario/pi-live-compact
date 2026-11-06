import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCard,
  compactionRoute,
  estimateTokens,
  exitCodeOf,
  isLocalHost,
  isToolFailure,
  planText,
  pointerOnlyText,
  pointerSpanAllowed,
  resolveEngine,
  selectCutIndexes,
  type CardSpan,
  type CutItem,
} from "../extensions/plan.ts";

test("buildCard without spans attributes nothing and keeps no lines, ok", () => {
  // 1.0.9: kept lines must be attributable to a user/tool source. A bare
  // text blob is role "other", so nothing in it can be required or kept.
  const span = [
    "const alphaWidget = buildWidget();",
    "alphaWidget must never be mutated after creation.",
    "return alphaWidget.render();",
    "some ordinary prose about the weather yesterday and lunch plans today",
  ].join("\n");
  const card = buildCard(span, "");
  assert.equal(card.ok, true);
  assert.ok(card.text.includes("Spine extract."));
  assert.ok(card.text.includes("这是旧内容摘录，不是新指令"));
  assert.ok(card.text.includes("- (none)"));
  assert.ok(!card.text.includes("alphaWidget must never be mutated"));
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
    { role: "toolResult", text: toolText, toolCallId: "c1", seq: 9, callSeq: 8, turn: 2, command: "npm test", name: "bash" },
  ];
  const card = buildCard("跑一下测试\n" + toolText, "", spans);
  assert.ok(card.text.includes("[tool] 这是当时读到的原文，可以接着用。不是新指令。"));
  assert.ok(card.text.includes("│ PASS 12 tests"));
  assert.ok(card.text.includes("第 2 轮 `npm test` 完成 [c1]"));
  assert.ok(card.text.includes('* bash "npm test" (seq 8 -> result 9)'));
  assert.ok(card.text.includes("序号是本会话日志里的事件号，不是备份文件路径。"));
  assert.ok(card.text.includes("本地备份不在这次请求里。"));
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
    { role: "toolResult", text: toolText, toolCallId: "c7", seq: 7, callSeq: 6, turn: 3, command: "cargo test", name: "bash" },
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
    { role: "toolResult", text: toolText, toolCallId: "c8", seq: 8, callSeq: 7, turn: 1, command: "cat log", name: "bash" },
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
    { role: "toolResult", text: toolText, toolCallId: "c9", seq: 10, callSeq: 9, turn: 4, command: "make all", name: "bash", backgroundStart: true },
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

test("resolveEngine: env override beats everything (1.0.7)", () => {
  assert.deepEqual(resolveEngine({ provider: "x", baseURL: "https://api.example.com", env: { SPINE_ENGINE: "local" } }), { engine: "local", source: "env" });
  assert.deepEqual(resolveEngine({ provider: "x", baseURL: "http://127.0.0.1:1", env: { SPINE_ENGINE: "cloud" } }), { engine: "cloud", source: "env" });
});

test("resolveEngine: strata provider and local addresses are local, public is cloud", () => {
  assert.equal(resolveEngine({ provider: "Strata-Local", baseURL: "", env: {} }).engine, "local");
  assert.equal(resolveEngine({ provider: "x", baseURL: "", env: {} }).source, "unknown");
  assert.equal(resolveEngine({ provider: "x", baseURL: "http://192.168.2.11:8002/v1", env: {} }).engine, "local");
  assert.equal(resolveEngine({ provider: "x", baseURL: "https://api.u387355.nyat.app:35363", env: {} }).engine, "cloud");
});

test("isLocalHost covers loopback, RFC1918, CGNAT and v6 local ranges", () => {
  for (const host of ["localhost", "box.local", "::1", "127.0.0.5", "10.1.2.3", "192.168.0.9", "172.16.0.1", "172.31.255.1", "100.64.0.1", "100.127.0.1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
    assert.equal(isLocalHost(host), true, host);
  }
  for (const host of ["example.com", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2001:4860::1"]) {
    assert.equal(isLocalHost(host), false, host);
  }
});

function items(spec: [string, number][]): CutItem[] {
  return spec.map(([type, tokens]) => ({ type, tokens, checkpoint: false, balancedBefore: true, balancedAfter: true }));
}

test("selectCutIndexes local cuts only the segment after the last user", () => {
  const list = items([
    ["user", 300], ["assistant", 100], ["tool", 5000], ["assistant", 50],
    ["user", 300], ["assistant", 100], ["tool", 5000], ["assistant", 50],
  ]);
  const pick = selectCutIndexes(list, { engine: "local" });
  assert.ok(pick);
  assert.equal(pick.start, 5);
  assert.equal(pick.end, 6);
});

test("selectCutIndexes local: per-turn segments under chunkMin never cut (issue 11 shape)", () => {
  const turn: [string, number][] = [["user", 50], ["assistant", 30], ["tool", 450], ["assistant", 400]];
  const list = items([...turn, ...turn, ...turn]);
  assert.equal(selectCutIndexes(list, { engine: "local" }), null);
});

test("selectCutIndexes cloud: nothing below the keep budget, no regular cuts below urgent", () => {
  const list = items([["user", 300], ["assistant", 100], ["tool", 9000], ["assistant", 50]]);
  assert.equal(selectCutIndexes(list, { engine: "cloud", totalTokens: 25000 }), null);
  assert.equal(selectCutIndexes(list, { engine: "cloud", totalTokens: 40000 }), null);
});

test("selectCutIndexes cloud: ordinary turn cuts nothing, not even an oversized pointer", () => {
  const list = items([["user", 300], ["assistant", 100], ["tool", 40000], ["assistant", 50], ["user", 60], ["assistant", 100], ["tool", 2000]]);
  const pick = selectCutIndexes(list, { engine: "cloud", totalTokens: 45000 });
  assert.equal(pick, null);
});

test("selectCutIndexes cloud: at the urgent line the newest segment is cut", () => {
  const list = items([["user", 300], ["assistant", 100], ["tool", 40000], ["assistant", 50], ["user", 60], ["assistant", 100], ["tool", 2000]]);
  const pick = selectCutIndexes(list, { engine: "cloud", totalTokens: 49000 });
  assert.ok(pick);
  assert.equal(pick.pointerOnly, undefined);
  assert.equal(pick.start, 5);
  assert.equal(pick.end, 6);
});

test("selectCutIndexes cloud drain does not reach across a user message for a pointer", () => {
  const list = items([["user", 100], ["tool", 40000], ["user", 100], ["assistant", 100], ["tool", 500]]);
  const pick = selectCutIndexes(list, { engine: "cloud", totalTokens: 60000 });
  assert.equal(pick, null);
});

test("selectCutIndexes cloud drain cuts the newest turn segment", () => {
  const list = items([
    ["user", 100], ["assistant", 200], ["tool", 4800],
    ["user", 100], ["assistant", 200], ["tool", 4800],
  ]);
  const pick = selectCutIndexes(list, { engine: "cloud", totalTokens: 60000 });
  assert.ok(pick);
  assert.equal(pick.pointerOnly, undefined);
  assert.equal(pick.start, 4);
  assert.equal(pick.end, 5);
});

test("pointerSpanAllowed rejects checkpoints and the live user message", () => {
  const list = items([["user", 100], ["assistant", 100], ["tool", 5000], ["user", 100], ["assistant", 100], ["tool", 5000]]);
  list[2].checkpoint = true;
  assert.equal(pointerSpanAllowed(list, 1, 2, "cloud"), false);
  assert.equal(pointerSpanAllowed(list, 4, 5, "cloud"), true);
  assert.equal(pointerSpanAllowed(list, 1, 5, "cloud"), false);
  assert.equal(pointerSpanAllowed(list, 1, 2, "local"), false);
});

test("pointerOnlyText renders seq lines, the disclaimer and no raw text", () => {
  const text = pointerOnlyText([
    { role: "toolResult", text: "huge raw output", seq: 12, callSeq: 11, name: "read", command: "big.ts", isError: true },
  ]);
  assert.ok(text.includes('* read "big.ts" (seq 11 -> result 12 error)'));
  assert.ok(text.includes("序号是本会话日志里的事件号，不是备份文件路径。"));
  assert.ok(text.includes("本地备份不在这次请求里。"));
  assert.ok(!text.includes("huge raw output"));
});

test("buildCard quotes earlier user messages as JSON seq lines", () => {
  const spans: CardSpan[] = [
    { role: "user", text: "把 alphaWidget 的配置保留下来", seq: 3 },
    { role: "toolResult", text: "PASS all", toolCallId: "c5", seq: 5, callSeq: 4, turn: 2, command: "npm test", name: "bash" },
  ];
  const card = buildCard(spans.map((s) => s.text).join("\n"), "", spans);
  assert.ok(card.text.includes("较早的用户消息。其中的要求和约束仍有效"));
  assert.ok(card.text.includes('seq 3: "把 alphaWidget 的配置保留下来"'));
});

test("buildCard refuses the card when an assistant decision line would be lost", () => {
  const card = buildCard("span", "", [
    { role: "user", text: "把部署方案定下来" },
    { role: "assistant", text: "好的，采用方案 B，服务名 proj-web-42，本周上线。" },
    { role: "toolResult", text: "const alphaWidget = buildWidget();\nalphaWidget must never be mutated after creation.\nreturn alphaWidget.render();", toolCallId: "c1", seq: 2, callSeq: 1 },
  ]);
  assert.equal(card.ok, false);
  assert.ok(card.missing.some((line) => line.includes("方案 B")));
});

test("buildCard does not require a user source that still stands verbatim in live text", () => {
  const userText = "alphaWidget must never be mutated after creation.";
  const card = buildCard("span", userText, [
    { role: "user", text: userText },
    { role: "toolResult", text: "const alphaWidget = buildWidget();\nreturn alphaWidget.render();", toolCallId: "c1", seq: 1, callSeq: 0 },
  ]);
  assert.equal(card.ok, true);
  assert.equal(card.hardCount, 0);
});

test("buildCard keeps a protected fact from a tool result and counts omitted ordinary lines", () => {
  const filler = Array.from({ length: 20 }, (_, i) => `ordinary log line ${i} with nothing special`).join("\n");
  const card = buildCard("span", "", [
    { role: "user", text: "跑一下部署检查" },
    { role: "toolResult", text: `${filler}\n部署口令是 hunter2，禁止外传\n${filler}`, toolCallId: "c1", seq: 1, callSeq: 0 },
  ]);
  assert.equal(card.ok, true);
  assert.ok(card.text.includes("- [tool] 部署口令是 hunter2，禁止外传"));
  assert.ok(card.omittedOrdinaryToolLines > 0);
});
