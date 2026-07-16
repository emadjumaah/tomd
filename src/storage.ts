// Local persistence for the converter: an auto-restored "last session" and a
// capped, newest-first history of conversions. All writes are quota-safe so
// very long documents can never crash the app — a failed write is simply
// skipped (for the session) or triggers eviction of the oldest history entry.

export type ConvertMode = "forward" | "reverse";

export interface HistoryEntry {
  id: string;
  mode: ConvertMode;
  /** forward: the editor's HTML; reverse: the Markdown source. */
  source: string;
  /** short plain-text snippet shown in the history list. */
  preview: string;
  /** epoch milliseconds. */
  ts: number;
}

export interface LastSession {
  mode: ConvertMode;
  forwardHtml: string;
  reverseMd: string;
}

const KEY_LAST = "tomd:last";
const KEY_HISTORY = "tomd:history";
const MAX_ENTRIES = 30;

export class ConversionStore {
  private safeSet(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (err) {
      // QuotaExceededError or a disabled/unavailable localStorage.
      console.warn("localStorage write skipped:", err);
      return false;
    }
  }

  private read<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      console.warn("localStorage read failed:", err);
      return null;
    }
  }

  // ── Last session ────────────────────────────────────────
  loadLast(): LastSession | null {
    return this.read<LastSession>(KEY_LAST);
  }

  saveLast(session: LastSession): void {
    // Best-effort: an enormous document may exceed quota; that's non-fatal.
    this.safeSet(KEY_LAST, JSON.stringify(session));
  }

  // ── History ─────────────────────────────────────────────
  loadHistory(): HistoryEntry[] {
    const list = this.read<HistoryEntry[]>(KEY_HISTORY);
    return Array.isArray(list) ? list : [];
  }

  getById(id: string): HistoryEntry | undefined {
    return this.loadHistory().find((e) => e.id === id);
  }

  /**
   * Add an entry (newest first). If it's identical to the most recent entry
   * (same mode + source) only its timestamp is refreshed. The list is capped
   * to MAX_ENTRIES, and if a write exceeds the storage quota the oldest
   * entries are dropped until it fits.
   */
  addHistory(entry: HistoryEntry): HistoryEntry[] {
    let list = this.loadHistory();

    if (
      list.length &&
      list[0].mode === entry.mode &&
      list[0].source === entry.source
    ) {
      list[0] = { ...list[0], ts: entry.ts };
    } else {
      list.unshift(entry);
    }

    if (list.length > MAX_ENTRIES) list = list.slice(0, MAX_ENTRIES);

    let ok = this.safeSet(KEY_HISTORY, JSON.stringify(list));
    while (!ok && list.length > 1) {
      list = list.slice(0, list.length - 1); // drop oldest, retry
      ok = this.safeSet(KEY_HISTORY, JSON.stringify(list));
    }
    return list;
  }

  deleteHistory(id: string): HistoryEntry[] {
    const list = this.loadHistory().filter((e) => e.id !== id);
    this.safeSet(KEY_HISTORY, JSON.stringify(list));
    return list;
  }

  clearHistory(): void {
    try {
      localStorage.removeItem(KEY_HISTORY);
    } catch (err) {
      console.warn("localStorage clear failed:", err);
    }
  }
}
