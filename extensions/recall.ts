// Recall store for the Pi port (PORTING #19).
//
// Upstream's host keeps cut originals in a shadow directory and offers a
// search API over them; Pi has neither, and the raw entries still live in
// its session file — but the model has no way to address them. So the port
// archives the original text of the tool results it cuts (sidecar JSONL
// next to the session file) and registers one tool, spine_recall, that
// hands an original back by the entry-id ref printed on the card. That
// closes the loop the pointer cards open: without it a model that still
// needs cut content can only re-read the source file, and the re-read is
// cut again a few steps later.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface RecallItem {
  id: string;
  label: string;
  text: string;
}

// Originals up to this many characters come back inline; larger ones are
// written to a file the model can page through with the read tool, so a
// recall does not re-inflate the context it was cut from.
export const RECALL_INLINE_LIMIT = 24000;

export class RecallStore {
  private items = new Map<string, RecallItem>();
  private sidecar: string | null = null;
  private dir: string | null = null;

  // Point the store at a session file and load its sidecar archive.
  // Re-binding to the same file is a no-op; switching files reloads.
  bind(sessionFile: string | undefined): void {
    if (!sessionFile) return;
    const sidecar = `${sessionFile}.spine.jsonl`;
    if (sidecar === this.sidecar) return;
    this.sidecar = sidecar;
    this.dir = dirname(sessionFile);
    this.items.clear();
    try {
      if (!existsSync(sidecar)) return;
      for (const line of readFileSync(sidecar, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const rec = JSON.parse(line);
          if (rec && typeof rec.id === "string" && typeof rec.text === "string") {
            this.items.set(rec.id, {
              id: rec.id,
              label: typeof rec.label === "string" ? rec.label : "",
              text: rec.text,
            });
          }
        } catch {
          // A torn final line must not lose the rest of the archive.
        }
      }
    } catch {
      // An unreadable archive degrades to in-memory only, never a crash.
    }
  }

  put(item: RecallItem): void {
    if (this.items.has(item.id)) return;
    this.items.set(item.id, item);
    if (this.sidecar) {
      try {
        appendFileSync(this.sidecar, `${JSON.stringify(item)}\n`);
      } catch {
        // Persistence is best-effort; the in-memory copy still serves.
      }
    }
  }

  get(id: string): RecallItem | undefined {
    return this.items.get(id);
  }

  list(limit = 8): RecallItem[] {
    return [...this.items.values()].slice(-limit).reverse();
  }

  get size(): number {
    return this.items.size;
  }

  dump(item: RecallItem): string {
    const path = join(this.dir ?? process.cwd(), `spine-recall-${item.id}.txt`);
    writeFileSync(path, item.text);
    return path;
  }
}

// The one line appended to a card naming the recall path for its span.
export function recallHint(items: RecallItem[]): string {
  const refs = items.map((item) => `spine_recall("${item.id}")＝${item.label}`).join("；");
  return `原文存档：需要本卡切掉的工具原文时用 ${refs} 取回，不要重新读取源文件。`;
}

export function recallResult(
  store: RecallStore,
  ref: string,
  toFile = false,
): { text: string; found: boolean } {
  const item = store.get(ref);
  if (!item) {
    const avail = store
      .list(8)
      .map((entry) => `${entry.id}＝${entry.label}`)
      .join("；");
    return {
      found: false,
      text: `没有找到 ref=${ref} 的存档。${avail ? `当前可用存档：${avail}。` : "当前没有任何存档。"}请核对 Spine 卡片上的 ref。`,
    };
  }
  if (!toFile && item.text.length <= RECALL_INLINE_LIMIT) {
    return { found: true, text: `这是 ${item.label} 被切掉的存档原文：\n${item.text}` };
  }
  const path = store.dump(item);
  return {
    found: true,
    text: `${item.label} 的存档原文共 ${item.text.length} 字，已写入 ${path}，用 read 工具读取（可带 offset/limit 分段）。开头预览：\n${item.text.slice(0, 500)}`,
  };
}
