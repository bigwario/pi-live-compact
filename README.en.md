# Live Compact for Pi

[中文](./README.md) | [English](./README.en.md)

Live Compact means compacting as you go — while the session is still alive,
not after the window has filled up.

This is a faithful port of
[dsh-live-compact](https://github.com/MerkyorLynn/dsh-live-compact)
(MerkyorLynn, MIT) to the Pi coding agent: the principles, thresholds and the
card algorithm match upstream 1.0.1, and the host-mechanism differences are
listed one by one in [PORTING.md](./PORTING.md).

Pi's built-in compaction works like DSH's stock behaviour: pile up to a
threshold, then call the model once for a big summarisation. This extension
does not wait. Once the context exceeds **20,000 tokens**, at the end of every
turn it cuts the **most recently finished chunk** locally — no model call, no
new tools, done in milliseconds. Everything before the cut point is left
untouched, so the prefix cache keeps hitting. The cut span is replaced by an
extractive card (repeated identifiers, obligation lines, error headers and
code lines preserved verbatim, within an 8K-character budget), and the cut
only goes ahead when the card can prove that no hard line was lost
(TRUNK CONFIRMED). Spans whose prose share is too high are not cut and are
left to Pi's built-in compaction — the same routing as upstream's wait-80.

One natural improvement over upstream: Pi session files are append-only and
the cut entries stay on record, so upstream's append-only plaintext shadow
directory is unnecessary — the card's trailer line references the session
entry id range instead.

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

The remaining constants match upstream's hard-coded values: 1K–32K tokens
per cut, an 8,000-character keep budget, 2,200 tokens of tail protection, no
urgent cuts below 48K, and spans above 650K are out of the small cuts' scope
(see PORTING.md #7).

## Tests

```sh
npm test   # node --test, 10 cases covering the card builder and span selection
```

## License and origin

MIT, see [LICENSE](./LICENSE). Original work © Merkyor, Pi port
© carrotciallo. For the principles and evaluation background, see the
upstream repository and its explainer page:
https://github.com/MerkyorLynn/dsh-live-compact
