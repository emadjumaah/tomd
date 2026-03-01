import { AdvancedHtmlToMarkdown } from "./converter";
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
  private isUpdatingFromEditor = false;
  private updateTimeout: number | null = null;

  constructor() {
    this.initializeEditor();
    this.initializeConverter();
    this.initializeMonaco();
    this.setupEventListeners();
    this.setupPasteHandling();
  }

  private initializeEditor(): void {
    this.editor = document.getElementById("editor") as HTMLElement;
    if (!this.editor) {
      throw new Error("Editor container not found");
    }
    this.editor.contentEditable = "true";
    this.editor.innerHTML = "";

    this.editor.addEventListener("input", () => {
      this.debounceUpdate(() => this.updateMarkdown());
    });
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
    // Tab switching
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", (e) => {
        const targetTab = (e.target as HTMLElement).dataset.tab;
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
    document
      .querySelectorAll(".tab")
      .forEach((tab) => tab.classList.remove("active"));
    document
      .querySelectorAll(".tab-content")
      .forEach((content) => content.classList.remove("active"));

    document.querySelector(`[data-tab="${tabName}"]`)?.classList.add("active");
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

        // Trigger conversion after DOM settles
        setTimeout(() => this.updateMarkdown(), 50);
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
        setTimeout(() => this.updateMarkdown(), 50);
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
      const markdown = this.mdEditor.getValue();
      const previewElement = document.getElementById("markdown-preview");

      if (previewElement) {
        let html = marked.parse(markdown) as string;

        // XSS hardening: strip javascript:/data: hrefs and inline event handlers
        html = html
          .replace(/\shref="(javascript|data):[^"]*"/gi, "")
          .replace(/\ssrc="(javascript|data):[^"]*"/gi, "")
          .replace(/\s+on\w+="[^"]*"/gi, "");

        previewElement.innerHTML = html;
      }
    } catch (error) {
      console.error("Error updating preview:", error);
    }
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
    this.editor.innerHTML = "";
    this.mdEditor.setValue("");
    const preview = document.getElementById("markdown-preview");
    if (preview) {
      preview.innerHTML =
        '<p style="color:#6c757d;text-align:center;margin-top:2rem">Preview will appear here once you add content...</p>';
    }
    this.updateStats();
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

  public getMarkdown(): string {
    return this.mdEditor.getValue();
  }

  public setContent(html: string): void {
    this.editor.innerHTML = html;
    this.updateMarkdown();
  }
}
