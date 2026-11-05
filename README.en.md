# Live Compact for Pi

[中文](./README.md) | [English](./README.en.md)

Live Compact means compacting as you go — while the session is still alive,
not after the window has filled up.

This is a faithful port of
[dsh-live-compact](https://github.com/MerkyorLynn/dsh-live-compact)
(MerkyorLynn, MIT) to the Pi coding agent: the principles, thresholds and the
card algorithm match upstream 1.0.8, and the host-mechanism differences are
listed one by one in [PORTING.md](./PORTING.md).

Pi's built-in compaction works like DSH's stock behaviour: pile up to a
threshold, then call the model once for a big summarisation. This extension
does not wait. Once the context exceeds **20,000 tokens**, at the end of every
turn it cuts the **most recently finished chunk** locally — no model call, no
new tools, done in milliseconds. Everything before the cut point is left
untouched, so the prefix cache keeps hitting. The cut span is replaced by an
extractive card, and the cut only goes ahead when the card can prove that no
hard line was lost. Spans whose prose share is too high are not cut and are
left to Pi's built-in compaction — the same routing as upstream's wait-80.

Semantics at 1.0.8 (synced with upstream):

- **Two engine modes**, resolved from the endpoint: a `strata` provider, or a
  loopback / LAN / Tailscale-range address, counts as **local** (cuts as
  before, always after the last user message). Anything else is **cloud**:
  below the keep budget (32K) regular spans are left alone and only oversized
  tool results are pointerised; once the total plus predicted next-turn
  growth passes the budget, draining starts — turn segments are cut one by
  one until the total is back under budget. `SPINE_ENGINE=local|cloud`
  forces the mode.
- **The newest 3 finished tool rounds stay verbatim** (within a combined
  32K-token budget); outside a drain, the cut must end before they start.
- Hard lines are claimed only from non-assistant messages, and kept lines are
  tagged with their original role. Completion claims in assistant prose do not
  count as hard lines; tool evidence records only the turn, the command, the
  exit status and the call id.
- Short tool results (≤12 lines and ≤512 chars) stay on the card verbatim.
  Failed tool results are excerpted first, and failure is recognised only from
  structural signals (non-zero exit codes, `isError`, `[stderr]` markers) —
  never from keywords.
- **Oversized tool results** (a single result over 32K tokens, adjustable)
  are not excerpted at all: the whole round is replaced by a pointer card
  that records only "call at sequence N → result at sequence M".
- Every cut tool result leaves a **sequence pointer** on the card (its event
  number in the session log; the card states explicitly that it is not a
  backup file path). Earlier user messages inside a cut span are preserved
  verbatim as JSON lines — their requirements and constraints stay in force.
- **Cut originals stay retrievable**: the extension registers one extra tool,
  `spine_recall`. When a span is cut, its largest tool originals are archived
  to a sidecar file next to the session, and the card's archive line prints
  the recall ref (the entry id). A model that still needs the original calls
  the tool instead of re-reading the source file. (Upstream covers this with
  the host's shadow search; Pi has none, so the port supplies the tool.)

One natural improvement over upstream: Pi session files are append-only and
the cut entries stay on record, so upstream's append-only plaintext shadow
directory is unnecessary — sequence pointers reference the session entries
directly.

## Installation

Requires Pi `1.2.0` (extension boundary API: `turn_end` proposing
`context_edit`).

```sh
# Enable as a local package directory (example)
pi install /path/to/pi-live-compact
# Or try it for a single run
pi -e /path/to/pi-live-compact/extensions/live-compact.ts
```

After installing, run a long task: if `context_edit` entries appear in the
session file and their content starts with `Spine extract.`, the cuts are
live.

## Parameters

Same names and meanings as upstream:

| Environment variable | Default | Purpose |
|---|---|---|
| `SPINE_MIN_TOKENS` | `20000` | Total-context threshold that triggers a small cut |
| `SPINE_KEEP_ROUNDS` | `3` | Newest finished tool rounds kept verbatim before the cut |
| `SPINE_KEEP_ROUND_TOKENS` | `32000` | Combined token budget for the kept rounds (also the cloud drain target) |
| `SPINE_ENGINE` | resolved from endpoint | Force the mode: `local` or `cloud` |
| `SPINE_POINTER_TOKENS` | `32000` | A single tool result above this is pointerised, not excerpted |
| `SPINE_CHUNK_MIN` | `1000` | Minimum gain (non-user tokens) for one cut |
| `SPINE_CHUNK_MAX` | `32000` | Maximum tokens per cut |

`SPINE_CHUNK_MIN` / `SPINE_CHUNK_MAX` are hard-coded constants upstream;
upstream issue #15 proposes turning them into environment variables with
unchanged defaults, and the Pi port adopts that suggestion early
(see PORTING.md #18).

The remaining constants match upstream's hard-coded values: an
8,000-character keep budget, 2,200 tokens of tail protection, no urgent cuts
below 48K, and spans above 650K are out of the small cuts' scope
(see PORTING.md #7).

## Tests

```sh
npm test   # node --test, 40 cases covering the card builder, engine resolution, span selection and the recall archive
```

## License and origin

MIT, see [LICENSE](./LICENSE). Original work © Merkyor, Pi port
© carrotciallo. For the principles and evaluation background, see the
upstream repository and its explainer page:
https://github.com/MerkyorLynn/dsh-live-compact
