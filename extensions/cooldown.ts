// Cooldown after the host's own compaction (upstream cooldown.js, 1.0.9).
//
// When Pi's official compaction has just produced a fresh summary, spine
// yields once: the pass right after it is skipped, so a cut cannot roll
// the new summary into a spine card. The primary test is identity, not
// time — each new official compaction (by entry id) skips exactly one
// pass, however long ago it landed. An optional time window
// (SPINE_COOLDOWN_MS, default 0 = off) additionally skips passes that
// start within the window after the compaction.
//
// 1.1.2 (upstream issue #29): a compaction that already sits in the
// projection when this instance starts observing is restored history,
// not a live event — it only primes the baseline and never makes a pass
// yield. Upstream draws the same line with the session's firstLiveSeq;
// Pi has no such boundary, so the tracker's first observation is it.
//
// Upstream reads the host surface for source.kind "compact-checkpoint";
// Pi projects a compaction as an entry whose projected items carry
// sourceEntry.type === "compaction", which is what is scanned here.

/** Default cooldown window: 5 minutes. Named, not a magic number. */
export const DEFAULT_COOLDOWN_MS = 300000;

/**
 * Parse the cooldown window. 0 (or negative, or unparsable) = the time
 * window is off and only the identity rule applies.
 */
export function resolveCooldownMs(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env?.SPINE_COOLDOWN_MS);
  if (!Number.isFinite(raw)) return 0;
  return raw <= 0 ? 0 : Math.floor(raw);
}

export interface OfficialCompaction {
  id: string;
  time: number;
}

/** The newest official compaction in a projected entry list, if any. */
export function latestOfficialCompaction(projected: any[]): OfficialCompaction | null {
  if (!Array.isArray(projected)) return null;
  for (let index = projected.length - 1; index >= 0; index -= 1) {
    const source = projected[index]?.sourceEntry;
    if (source?.type === "compaction" && typeof source.id === "string") {
      const time = Date.parse(source.timestamp || "");
      return { id: source.id, time: Number.isFinite(time) ? time : 0 };
    }
  }
  return null;
}

/** True while the newest official compaction is younger than the window. */
export function inCooldownWindow(official: OfficialCompaction | null, windowMs: number, now = Date.now()): boolean {
  if (!official || !(windowMs > 0) || !official.time) return false;
  return now - official.time < windowMs;
}

/**
 * Once-per-live-card tracker for the identity rule. The first observed
 * state — with or without a compaction in it — only primes the baseline:
 * a card already there is restored history and never yields a pass.
 * Afterwards, a compaction whose id differs from the primed/last-seen id
 * is live and yields exactly one pass; repeats of the same id do not.
 */
export function createOfficialCompactionTracker(): { observe(official: OfficialCompaction | null): boolean } {
  let primed = false;
  let seen: string | undefined;
  return {
    observe(official: OfficialCompaction | null): boolean {
      if (!primed) {
        primed = true;
        seen = official?.id;
        return false;
      }
      if (official && official.id !== seen) {
        seen = official.id;
        return true;
      }
      return false;
    },
  };
}
