import { AdvancedHtmlToMarkdown } from "./converter";
import { ConversionStore } from "./storage";
import { marked } from "marked";
import * as monaco from "monaco-editor";

// Configure Monaco workers — use a minimal blob worker so Monaco initialises
// without errors even when no real language-server workers are bundled.
(window as any).MonacoEnvironment = {
  getWorker(_moduleId: string, _label: string): Worker {
    const blob = new Blob(["self.onmessage = function() {};"], {
      type: "application/javascript",
    });
    return new Worker(URL.createObjectURL(blob));
  },
};

// Use the modern marked.use() API (marked.setOptions is deprecated in v5+).
// gfm is true by default; we only need to opt-in to soft-break support.
marked.use({ breaks: true });

export class WebToMarkdownApp {
  private editor!: HTMLElement;
  private converter!: AdvancedHtmlToMarkdown;
  private mdEditor!: monaco.editor.IStandaloneCodeEditor;
  private mdInput?: monaco.editor.IStandaloneCodeEditor; // reverse-mode input (lazy)
  private mode: "forward" | "reverse" = "forward";
  private isUpdatingFromEditor = false;
  private updateTimeout: number | null = null;

  // Undo/redo history for the WYSIWYG editor
  private history: string[] = [""];
  private historyIndex = 0;
  private readonly MAX_HISTORY = 50;

  // Local persistence (last session + conversion history)
  private store = new ConversionStore();
  private saveTimeout: number | null = null;
  /** Reverse-mode Markdown restored before its editor exists yet. */
  private pendingReverseMd = "";

  constructor() {
    this.initializeEditor();
    this.initializeConverter();
    this.initializeMonaco();
    this.setupEventListeners();
    this.setupPasteHandling();
    this.setupModeToggle();
    this.setupSplitters();
    this.setupHistoryUI();
    this.restoreLastSession();
  }

  private initializeEditor(): void {
    this.editor = document.getElementById("editor") as HTMLElement;
    if (!this.editor) {
      throw new Error("Editor container not found");
    }
    this.editor.contentEditable = "true";
    this.editor.innerHTML = "";

    this.editor.addEventListener("input", () => {
      this.debounceUpdate(() => {
        this.updateMarkdown();
        this.saveSnapshot();
      });
      this.scheduleSave();
    });

    this.editor.addEventListener("keydown", (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        this.undo();
      } else if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        this.redo();
      }
    });
  }

  private saveSnapshot(): void {
    const current = this.editor.innerHTML;
    if (this.history[this.historyIndex] === current) return;
    // Discard any redo states ahead of current position
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(current);
    if (this.history.length > this.MAX_HISTORY) {
      this.history.shift();
    } else {
      this.historyIndex++;
    }
    this.updateUndoRedoButtons();
  }

  private undo(): void {
    if (this.historyIndex <= 0) return;
    this.historyIndex--;
    this.editor.innerHTML = this.history[this.historyIndex];
    this.updateMarkdown();
    this.updateUndoRedoButtons();
  }

  private redo(): void {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex++;
    this.editor.innerHTML = this.history[this.historyIndex];
    this.updateMarkdown();
    this.updateUndoRedoButtons();
  }

  private updateUndoRedoButtons(): void {
    const undoBtn = document.getElementById("undo-btn") as HTMLButtonElement | null;
    const redoBtn = document.getElementById("redo-btn") as HTMLButtonElement | null;
    if (undoBtn) undoBtn.disabled = this.historyIndex <= 0;
    if (redoBtn) redoBtn.disabled = this.historyIndex >= this.history.length - 1;
  }

  private initializeConverter(): void {
    this.converter = new AdvancedHtmlToMarkdown();
  }

  private initializeMonaco(): void {
    const mdEditorContainer = document.getElementById(
      "markdown-editor",
    ) as HTMLElement;
    if (!mdEditorContainer) {
      throw new Error("Markdown editor container not found");
    }

    this.mdEditor = monaco.editor.create(mdEditorContainer, {
      value: "",
      language: "markdown",
      theme: "vs-dark",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 14,
      lineNumbers: "on",
      wordWrap: "on",
      automaticLayout: true,
      readOnly: false,
      padding: { top: 10 },
    });
  }

  private setupEventListeners(): void {
    // Tab switching (forward view only)
    document.querySelectorAll("#forward-view .tab").forEach((tab) => {
      tab.addEventListener("click", (e) => {
        const targetTab = (e.currentTarget as HTMLElement).dataset.tab;
        if (targetTab) {
          this.switchTab(targetTab);
        }
      });
    });

    // Monaco editor changes → update preview and stats
    this.mdEditor.onDidChangeModelContent(() => {
      if (!this.isUpdatingFromEditor) {
        this.debounceUpdate(() => this.updatePreview());
      }
      this.updateStats();
    });

    document.getElementById("undo-btn")?.addEventListener("click", () => {
      this.undo();
    });

    document.getElementById("redo-btn")?.addEventListener("click", () => {
      this.redo();
    });

    document.getElementById("copy-md")?.addEventListener("click", () => {
      this.copyMarkdown();
    });

    document.getElementById("clear-all")?.addEventListener("click", () => {
      this.clearAll();
    });

    document.getElementById("download-md")?.addEventListener("click", () => {
      this.downloadMarkdown();
    });
  }

  private switchTab(tabName: string): void {
    const view = document.getElementById("forward-view");
    if (!view) return;

    view
      .querySelectorAll(".tab")
      .forEach((tab) => tab.classList.remove("active"));
    view
      .querySelectorAll(".tab-content")
      .forEach((content) => content.classList.remove("active"));

    view.querySelector(`[data-tab="${tabName}"]`)?.classList.add("active");
    document.getElementById(`${tabName}-tab`)?.classList.add("active");

    if (tabName === "editor") {
      setTimeout(() => {
        this.mdEditor.layout();
      }, 100);
    }
  }

  private setupPasteHandling(): void {
    this.editor.addEventListener("paste", async (event: ClipboardEvent) => {
      event.preventDefault();

      const clipboardData = event.clipboardData;
      if (!clipboardData) return;

      // Prefer HTML (preserves formatting); fall back to plain text
      const htmlData = clipboardData.getData("text/html");
      if (htmlData) {
        const processedHtml = this.processPastedHtml(htmlData);

        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();

          const tempDiv = document.createElement("div");
          tempDiv.innerHTML = processedHtml;
          const fragment = document.createDocumentFragment();
          while (tempDiv.firstChild) {
            fragment.appendChild(tempDiv.firstChild);
          }
          range.insertNode(fragment);
        } else {
          this.editor.innerHTML = processedHtml;
        }

        // Trigger conversion after DOM settles, then archive this conversion.
        setTimeout(() => {
          this.updateMarkdown();
          this.saveSnapshot();
          this.archiveForward();
          this.scheduleSave();
        }, 50);
        return;
      }

      const textData = clipboardData.getData("text/plain");
      if (textData) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(textData));
        } else {
          this.editor.innerText = textData;
        }
        setTimeout(() => {
          this.updateMarkdown();
          this.saveSnapshot();
          this.archiveForward();
          this.scheduleSave();
        }, 50);
      }
    });
  }

  private processPastedHtml(html: string): string {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = html;

    // Remove unwanted elements
    tempDiv
      .querySelectorAll("script, style, meta, link, noscript")
      .forEach((el) => el.remove());

    // Strip all attributes except a safe whitelist
    tempDiv.querySelectorAll("*").forEach((el) => {
      const keepAttrs = ["href", "src", "alt", "title", "colspan", "rowspan"];
      Array.from(el.attributes).forEach((attr) => {
        if (!keepAttrs.includes(attr.name)) {
          el.removeAttribute(attr.name);
        }
      });
      // Reject javascript: and data: hrefs/srcs
      const href = el.getAttribute("href");
      if (href && /^(javascript|data):/i.test(href)) {
        el.removeAttribute("href");
      }
      const src = el.getAttribute("src");
      if (src && /^(javascript|data):/i.test(src)) {
        el.removeAttribute("src");
      }
    });

    // Fix tables that use <th> without <thead>
    tempDiv.querySelectorAll("table").forEach((table) => {
      if (
        !table.querySelector("thead") &&
        table.querySelector("tr:first-child th")
      ) {
        const thead = document.createElement("thead");
        const firstRow = table.querySelector("tr:first-child");
        if (firstRow) {
          thead.appendChild(firstRow);
          table.insertBefore(thead, table.firstChild);
        }
      }
    });

    return tempDiv.innerHTML;
  }

  private debounceUpdate(callback: () => Promise<void> | void): void {
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }
    this.updateTimeout = window.setTimeout(callback, 300);
  }

  private updateMarkdown(): void {
    try {
      this.isUpdatingFromEditor = true;

      const html = this.editor.innerHTML;
      const markdown = this.converter.convert(html);

      this.mdEditor.setValue(markdown);
      this.updateStats();
      this.updatePreview();
    } catch (error) {
      console.error("Error updating markdown:", error);
      this.mdEditor.setValue(
        "# Conversion Error\n\nThere was an error converting the content.",
      );
    } finally {
      this.isUpdatingFromEditor = false;
    }
  }

  private updatePreview(): void {
    try {
      const previewElement = document.getElementById("markdown-preview");
      if (previewElement) {
        previewElement.innerHTML = this.renderMarkdownToHtml(
          this.mdEditor.getValue(),
        );
      }
    } catch (error) {
      console.error("Error updating preview:", error);
    }
  }

  /** Render Markdown to sanitized HTML (shared by both previews + export). */
  private renderMarkdownToHtml(markdown: string): string {
    let html = marked.parse(markdown) as string;

    // XSS hardening: strip javascript:/data: hrefs and inline event handlers
    html = html
      .replace(/\shref="(javascript|data):[^"]*"/gi, "")
      .replace(/\ssrc="(javascript|data):[^"]*"/gi, "")
      .replace(/\s+on\w+="[^"]*"/gi, "");

    return html;
  }

  private updateStats(): void {
    const markdown = this.mdEditor.getValue();
    const statsEl = document.getElementById("md-stats");
    if (!statsEl) return;

    const chars = markdown.length;
    const words = markdown.trim() === "" ? 0 : markdown.trim().split(/\s+/).length;
    const lines = markdown === "" ? 0 : markdown.split("\n").length;
    statsEl.textContent = `${words} words · ${chars} chars · ${lines} lines`;
  }

  private async copyMarkdown(): Promise<void> {
    const markdown = this.mdEditor.getValue();
    if (!markdown) return;

    try {
      await navigator.clipboard.writeText(markdown);

      const button = document.getElementById("copy-md") as HTMLButtonElement;
      const originalText = button.textContent;
      button.textContent = "✓ Copied!";
      button.classList.add("success");

      setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove("success");
      }, 2000);
    } catch (error) {
      console.error("Failed to copy markdown:", error);
    }
  }

  private clearAll(): void {
    this.archiveForward(); // keep what's being cleared in history
    this.editor.innerHTML = "";
    this.mdEditor.setValue("");
    const preview = document.getElementById("markdown-preview");
    if (preview) {
      preview.innerHTML =
        '<p style="color:#6c757d;text-align:center;margin-top:2rem">Preview will appear here once you add content...</p>';
    }
    this.updateStats();
    this.saveSnapshot();
    this.scheduleSave();
  }

  private downloadMarkdown(): void {
    const markdown = this.mdEditor.getValue();
    if (!markdown) return;

    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `converted-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Resizable split between the two panels ────────────────

  private setupSplitters(): void {
    const MIN_PANEL = 240; // px — minimum width for either side

    document
      .querySelectorAll<HTMLElement>(".splitter")
      .forEach((splitter) => {
        const container = splitter.parentElement;
        const leftPanel = splitter.previousElementSibling as HTMLElement | null;
        if (!container || !leftPanel) return;

        let dragging = false;

        const onMove = (e: PointerEvent) => {
          if (!dragging) return;
          const rect = container.getBoundingClientRect();
          const max = rect.width - MIN_PANEL;
          let leftWidth = e.clientX - rect.left;
          leftWidth = Math.max(MIN_PANEL, Math.min(leftWidth, max));
          // Store as a percentage so the split stays proportional on window resize.
          leftPanel.style.flex = `0 0 ${(leftWidth / rect.width) * 100}%`;
        };

        const onUp = () => {
          if (!dragging) return;
          dragging = false;
          splitter.classList.remove("dragging");
          document.body.classList.remove("resizing");
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          this.relayoutEditors();
        };

        splitter.addEventListener("pointerdown", (e: PointerEvent) => {
          dragging = true;
          splitter.classList.add("dragging");
          document.body.classList.add("resizing");
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
          e.preventDefault();
        });

        // Double-click resets to the default 50/50 split.
        splitter.addEventListener("dblclick", () => {
          leftPanel.style.flex = "";
          this.relayoutEditors();
        });
      });
  }

  /** Re-layout Monaco editors after the panel widths change. */
  private relayoutEditors(): void {
    this.mdEditor.layout();
    this.mdInput?.layout();
  }

  // ── Reverse mode: Markdown → Web ──────────────────────────

  private setupModeToggle(): void {
    document
      .getElementById("mode-forward-btn")
      ?.addEventListener("click", () => this.switchMode("forward"));
    document
      .getElementById("mode-reverse-btn")
      ?.addEventListener("click", () => this.switchMode("reverse"));

    // Reverse-view tab switching (Preview / HTML)
    document.querySelectorAll("#reverse-view .tab").forEach((tab) => {
      tab.addEventListener("click", (e) => {
        const target = (e.currentTarget as HTMLElement).dataset.revtab;
        if (target) this.switchRevTab(target);
      });
    });

    document
      .getElementById("rev-clear")
      ?.addEventListener("click", () => this.clearReverse());
    document
      .getElementById("rev-copy-html")
      ?.addEventListener("click", () => this.copyHtml());
    document
      .getElementById("rev-download-html")
      ?.addEventListener("click", () => this.downloadHtml());
  }

  private switchMode(mode: "forward" | "reverse"): void {
    if (this.mode === mode) return;
    this.mode = mode;

    document.body.classList.toggle("mode-forward", mode === "forward");
    document.body.classList.toggle("mode-reverse", mode === "reverse");
    document
      .getElementById("mode-forward-btn")
      ?.classList.toggle("active", mode === "forward");
    document
      .getElementById("mode-reverse-btn")
      ?.classList.toggle("active", mode === "reverse");

    const title = document.getElementById("app-title");
    const subtitle = document.getElementById("app-subtitle");
    const badge = document.getElementById("header-badge");

    if (mode === "reverse") {
      if (title) title.textContent = "Markdown to Web";
      if (subtitle)
        subtitle.textContent =
          "Paste Markdown on the left — get the rendered web view on the right";
      if (badge) badge.textContent = "Live HTML render";

      // Monaco must be created while its container is visible to size correctly.
      this.ensureMdInput();
      setTimeout(() => this.mdInput?.layout(), 50);
    } else {
      if (title) title.textContent = "Web to Markdown";
      if (subtitle)
        subtitle.textContent =
          "Paste rich content on the left — get clean Markdown on the right";
      if (badge) badge.textContent = "GFM + Tables + Code";

      setTimeout(() => this.mdEditor.layout(), 50);
    }

    this.scheduleSave();
  }

  /** Lazily create the reverse-mode Markdown input editor on first use. */
  private ensureMdInput(): void {
    if (this.mdInput) return;

    const container = document.getElementById("md-input");
    if (!container) return;

    this.mdInput = monaco.editor.create(container, {
      value: this.pendingReverseMd || "",
      language: "markdown",
      theme: "vs-dark",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 14,
      lineNumbers: "on",
      wordWrap: "on",
      automaticLayout: true,
      readOnly: false,
      padding: { top: 10 },
    });

    this.mdInput.onDidChangeModelContent(() => {
      this.debounceUpdate(() => this.updateWebView());
      this.updateRevStats();
      this.scheduleSave();
    });

    // Archive on paste (a distinct "conversion"), after the model settles.
    this.mdInput.onDidPaste(() => {
      setTimeout(() => this.archiveReverse(), 0);
    });

    this.updateWebView();
    this.updateRevStats();
  }

  private switchRevTab(tabName: string): void {
    const view = document.getElementById("reverse-view");
    if (!view) return;

    view
      .querySelectorAll(".tab")
      .forEach((tab) => tab.classList.remove("active"));
    view
      .querySelectorAll(".tab-content")
      .forEach((content) => content.classList.remove("active"));

    view
      .querySelector(`[data-revtab="${tabName}"]`)
      ?.classList.add("active");
    document.getElementById(`rev-${tabName}-tab`)?.classList.add("active");
  }

  private updateWebView(): void {
    try {
      const markdown = this.mdInput?.getValue() ?? "";
      const hasContent = markdown.trim() !== "";
      const html = this.renderMarkdownToHtml(markdown);

      const preview = document.getElementById("web-preview");
      if (preview) {
        preview.innerHTML = hasContent
          ? html
          : '<p style="color:#94a3b8;text-align:center;margin-top:3rem;font-size:0.9rem">Rendered web view will appear here once you paste Markdown…</p>';
      }

      const output = document.getElementById("html-output");
      if (output) output.textContent = hasContent ? html : "";
    } catch (error) {
      console.error("Error updating web view:", error);
    }
  }

  private updateRevStats(): void {
    const markdown = this.mdInput?.getValue() ?? "";
    const statsEl = document.getElementById("rev-stats");
    if (!statsEl) return;

    const chars = markdown.length;
    const words =
      markdown.trim() === "" ? 0 : markdown.trim().split(/\s+/).length;
    const lines = markdown === "" ? 0 : markdown.split("\n").length;
    statsEl.textContent = `${words} words · ${chars} chars · ${lines} lines`;
  }

  private async copyHtml(): Promise<void> {
    const markdown = this.mdInput?.getValue() ?? "";
    if (!markdown.trim()) return;

    try {
      await navigator.clipboard.writeText(this.renderMarkdownToHtml(markdown));

      const button = document.getElementById(
        "rev-copy-html",
      ) as HTMLButtonElement;
      const originalText = button.textContent;
      button.textContent = "✓ Copied!";
      button.classList.add("success");

      setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove("success");
      }, 2000);
    } catch (error) {
      console.error("Failed to copy HTML:", error);
    }
  }

  private downloadHtml(): void {
    const markdown = this.mdInput?.getValue() ?? "";
    if (!markdown.trim()) return;

    const doc = this.wrapStandaloneHtml(this.renderMarkdownToHtml(markdown));
    const blob = new Blob([doc], { type: "text/html" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `converted-${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** Wrap rendered HTML in a minimal, self-contained, styled document. */
  private wrapStandaloneHtml(body: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Converted from Markdown</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.7; color: #1e293b; max-width: 800px; margin: 2rem auto; padding: 0 1.25rem; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin-top: 1.4rem; }
  h1 { border-bottom: 2px solid #e2e8f0; padding-bottom: .3rem; }
  h2 { border-bottom: 1px solid #e2e8f0; padding-bottom: .25rem; }
  a { color: #6366f1; }
  code { background: #f1f5f9; padding: .15rem .4rem; border-radius: 3px; font-family: Menlo, Consolas, monospace; }
  pre { background: #0d1117; color: #e2e8f0; padding: 1rem 1.25rem; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; color: inherit; }
  blockquote { border-left: 4px solid #6366f1; padding-left: 1rem; color: #64748b; margin: 1rem 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #e2e8f0; padding: .5rem .75rem; text-align: left; }
  th { background: #f8fafc; }
  img { max-width: 100%; }
</style>
</head>
<body>
${body}
</body>
</html>`;
  }

  private clearReverse(): void {
    this.archiveReverse(); // keep what's being cleared in history
    this.pendingReverseMd = "";
    this.mdInput?.setValue("");
    this.updateWebView();
    this.updateRevStats();
    this.scheduleSave();
  }

  // ── Persistence: last session + conversion history ────────

  private newId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  private scheduleSave(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = window.setTimeout(() => this.saveWorkingState(), 600);
  }

  private saveWorkingState(): void {
    this.store.saveLast({
      mode: this.mode,
      forwardHtml: this.editor.innerHTML,
      reverseMd: this.mdInput ? this.mdInput.getValue() : this.pendingReverseMd,
    });
  }

  private restoreLastSession(): void {
    const last = this.store.loadLast();
    this.refreshHistoryCount();
    if (!last) return;

    if (last.reverseMd) this.pendingReverseMd = last.reverseMd;

    if (last.forwardHtml) {
      this.editor.innerHTML = last.forwardHtml;
      // Populate the Markdown pane now, even if reverse mode is the one shown.
      this.updateMarkdown();
      this.saveSnapshot();
    }

    if (last.mode === "reverse") {
      this.switchMode("reverse"); // creates mdInput seeded with pendingReverseMd
    }
  }

  /** Plain-text snippet for the history list (RTL-safe, single line). */
  private makePreview(text: string): string {
    return text.replace(/\s+/g, " ").trim().slice(0, 140);
  }

  private archiveForward(): void {
    const html = this.editor.innerHTML;
    const text = (this.editor.textContent || "").trim();
    if (!html.trim() || !text) return;
    this.store.addHistory({
      id: this.newId(),
      mode: "forward",
      source: html,
      preview: this.makePreview(text),
      ts: Date.now(),
    });
    this.refreshHistoryUI();
  }

  private archiveReverse(): void {
    const md = this.mdInput?.getValue() ?? "";
    if (!md.trim()) return;
    // Strip the most common Markdown punctuation for a cleaner preview.
    const text = md.replace(/[#>*`_~]|^[-+]\s/gm, " ");
    this.store.addHistory({
      id: this.newId(),
      mode: "reverse",
      source: md,
      preview: this.makePreview(text),
      ts: Date.now(),
    });
    this.refreshHistoryUI();
  }

  // ── History overlay UI ────────────────────────────────────

  private setupHistoryUI(): void {
    document
      .getElementById("history-btn")
      ?.addEventListener("click", () => this.openHistory());
    document
      .getElementById("history-close")
      ?.addEventListener("click", () => this.closeHistory());
    document.getElementById("history-clear")?.addEventListener("click", () => {
      this.store.clearHistory();
      this.renderHistory();
      this.refreshHistoryCount();
    });

    document
      .querySelectorAll("#history-overlay [data-close]")
      .forEach((el) => el.addEventListener("click", () => this.closeHistory()));

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.closeHistory();
    });

    // Event delegation: click a row to restore, the trash icon to delete.
    document.getElementById("history-list")?.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const del = target.closest(".history-delete") as HTMLElement | null;
      if (del?.dataset.id) {
        this.store.deleteHistory(del.dataset.id);
        this.renderHistory();
        this.refreshHistoryCount();
        return;
      }
      const row = target.closest(".history-row") as HTMLElement | null;
      if (row?.dataset.id) this.restoreEntry(row.dataset.id);
    });
  }

  private openHistory(): void {
    this.renderHistory();
    const overlay = document.getElementById("history-overlay");
    if (overlay) overlay.hidden = false;
  }

  private closeHistory(): void {
    const overlay = document.getElementById("history-overlay");
    if (overlay) overlay.hidden = true;
  }

  private refreshHistoryCount(): void {
    const n = this.store.loadHistory().length;
    const btnCount = document.getElementById("history-count");
    const panelCount = document.getElementById("history-count-panel");
    if (btnCount) {
      btnCount.textContent = String(n);
      btnCount.hidden = n === 0;
    }
    if (panelCount) panelCount.textContent = String(n);
  }

  private refreshHistoryUI(): void {
    this.refreshHistoryCount();
    const overlay = document.getElementById("history-overlay");
    if (overlay && !overlay.hidden) this.renderHistory();
  }

  private relativeTime(ts: number): string {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 45) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(ts).toLocaleDateString();
  }

  private renderHistory(): void {
    const listEl = document.getElementById("history-list");
    const emptyEl = document.getElementById("history-empty");
    if (!listEl || !emptyEl) return;

    const items = this.store.loadHistory();
    listEl.innerHTML = "";
    emptyEl.hidden = items.length > 0;

    for (const entry of items) {
      const row = document.createElement("div");
      row.className = "history-row";
      row.dataset.id = entry.id;
      row.title = "Click to restore";

      const badge = document.createElement("span");
      badge.className =
        "history-badge " +
        (entry.mode === "forward" ? "badge-forward" : "badge-reverse");
      badge.textContent = entry.mode === "forward" ? "HTML → MD" : "MD → Web";

      const main = document.createElement("div");
      main.className = "history-row-main";

      const preview = document.createElement("div");
      preview.className = "history-preview";
      preview.textContent = entry.preview || "(empty)";

      const meta = document.createElement("div");
      meta.className = "history-meta";
      meta.textContent = `${this.relativeTime(entry.ts)} · ${entry.source.length.toLocaleString()} chars`;

      main.appendChild(preview);
      main.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "history-row-actions";
      const del = document.createElement("button");
      del.className = "btn btn-icon history-delete";
      del.dataset.id = entry.id;
      del.title = "Delete";
      del.setAttribute("aria-label", "Delete");
      del.textContent = "🗑";
      actions.appendChild(del);

      row.appendChild(badge);
      row.appendChild(main);
      row.appendChild(actions);
      listEl.appendChild(row);
    }
  }

  private restoreEntry(id: string): void {
    const entry = this.store.getById(id);
    if (!entry) return;

    if (entry.mode === "forward") {
      if (this.mode !== "forward") this.switchMode("forward");
      this.editor.innerHTML = entry.source;
      this.updateMarkdown();
      this.saveSnapshot();
    } else {
      this.pendingReverseMd = entry.source;
      if (this.mode !== "reverse") this.switchMode("reverse");
      this.ensureMdInput();
      if (this.mdInput && this.mdInput.getValue() !== entry.source) {
        this.mdInput.setValue(entry.source);
      }
      this.updateWebView();
      this.updateRevStats();
    }

    this.closeHistory();
    this.saveWorkingState();
  }

  public getMarkdown(): string {
    return this.mdEditor.getValue();
  }

  public setContent(html: string): void {
    this.editor.innerHTML = html;
    this.updateMarkdown();
  }
}
