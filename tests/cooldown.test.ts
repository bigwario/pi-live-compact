import assert from "node:assert/strict";
import test from "node:test";
import { inCooldownWindow, latestOfficialCompaction, resolveCooldownMs } from "../extensions/cooldown.ts";

test("resolveCooldownMs defaults to off and parses plain values", () => {
  assert.equal(resolveCooldownMs({}), 0);
  assert.equal(resolveCooldownMs({ SPINE_COOLDOWN_MS: "5000" }), 5000);
  assert.equal(resolveCooldownMs({ SPINE_COOLDOWN_MS: "-3" }), 0);
  assert.equal(resolveCooldownMs({ SPINE_COOLDOWN_MS: "abc" }), 0);
});

const projectedWith = (entries: any[]) => entries;

test("latestOfficialCompaction finds the newest compaction entry", () => {
  const projected = projectedWith([
    { sourceEntry: { type: "message", id: "m1" } },
    { sourceEntry: { type: "compaction", id: "c1", timestamp: "2026-11-06T00:00:00.000Z" } },
    { sourceEntry: { type: "message", id: "m2" } },
    { sourceEntry: { type: "compaction", id: "c2", timestamp: "2026-11-06T01:00:00.000Z" } },
    { sourceEntry: { type: "message", id: "m3" } },
  ]);
  const found = latestOfficialCompaction(projected);
  assert.equal(found?.id, "c2");
  assert.equal(found?.time, Date.parse("2026-11-06T01:00:00.000Z"));
  assert.equal(latestOfficialCompaction(projectedWith([{ sourceEntry: { type: "message", id: "m1" } }])), null);
  assert.equal(latestOfficialCompaction([]), null);
});

test("inCooldownWindow only fires inside a positive window", () => {
  const official = { id: "c1", time: 100000 };
  assert.equal(inCooldownWindow(official, 0, 100500), false);
  assert.equal(inCooldownWindow(official, 60000, 100500), true);
  assert.equal(inCooldownWindow(official, 60000, 200000), false);
  assert.equal(inCooldownWindow(null, 60000, 100500), false);
});
