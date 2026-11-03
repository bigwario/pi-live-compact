import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCard, compactionRoute, estimateTokens, planText } from "../extensions/plan.ts";

test("buildCard keeps repeated names and obligation lines, verdict CONFIRMED", () => {
  const span = [
    "const alphaWidget = buildWidget();",
    "alphaWidget must never be mutated after creation.",
    "return alphaWidget.render();",
    "some ordinary prose about the weather yesterday and lunch plans today",
  ].join("\n");
  const card = buildCard(span, "");
  assert.equal(card.verdict, "TRUNK CONFIRMED");
  assert.ok(card.text.includes("alphaWidget must never be mutated"));
  assert.ok(card.text.includes("Spine extract."));
});

test("buildCard verdict UNCONFIRMED when hard lines overflow the keep budget", () => {
  const lines: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    lines.push(`rule number ${i} must always hold for the calibration table entry ${i} ` + "x".repeat(220));
  }
  const card = buildCard(lines.join("\n"), "");
  assert.equal(card.verdict, "TRUNK UNCONFIRMED");
  assert.ok(card.omittedHard > 0);
  assert.ok(card.missing.length > 0);
});

test("buildCard verdict CONFIRMED when a hard line survives in live context", () => {
  const lines: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    lines.push(`rule number ${i} must always hold for the calibration table entry ${i} ` + "x".repeat(220));
  }
  const live = lines.join("\n");
  const card = buildCard(lines.join("\n"), live);
  assert.equal(card.verdict, "TRUNK CONFIRMED");
  assert.equal(card.missing.length, 0);
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
