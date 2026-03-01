import { AdvancedHtmlToMarkdown } from "./converter";
import { marked } from "marked";
import * as monaco from "monaco-editor";

// Configure Monaco to work without web workers
(window as any).MonacoEnvironment = {
  getWorkerUrl: function (_moduleId: string, _label: string) {
    return "";
  },
  getWorker: function (_moduleId: string, _label: string) {
    return new Worker("");
  },
};

export class WebToMarkdownApp {
  private editor!: HTMLElement;
  private converter!: AdvancedHtmlToMarkdown;
  private mdEditor!: monaco.editor.IStandaloneCodeEditor;
  private isUpdatingFromEditor = false;
  private isUpdatingFromMonaco = false;
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

    // Add input event listener for conversion
    this.editor.addEventListener("input", () => {
      if (!this.isUpdatingFromMonaco) {
        this.debounceUpdate(() => this.updateMarkdown());
      }
    });

    // Also listen for paste events
    this.editor.addEventListener("paste", () => {
      setTimeout(() => {
        if (!this.isUpdatingFromMonaco) {
          this.debounceUpdate(() => this.updateMarkdown());
        }
      }, 100);
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

    // Configure marked for preview
    marked.setOptions({
      gfm: true,
      breaks: true,
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

    // Monaco editor changes
    this.mdEditor.onDidChangeModelContent(() => {
      if (!this.isUpdatingFromEditor) {
        this.debounceUpdate(async () => await this.updatePreview());
      }
    });

    // Copy button
    document.getElementById("copy-md")?.addEventListener("click", () => {
      this.copyMarkdown();
    });

    // Clear button
    document.getElementById("clear-all")?.addEventListener("click", () => {
      this.clearAll();
    });

    // Download button
    document.getElementById("download-md")?.addEventListener("click", () => {
      this.downloadMarkdown();
    });
  }

  private switchTab(tabName: string): void {
    // Remove active class from all tabs and contents
    document
      .querySelectorAll(".tab")
      .forEach((tab) => tab.classList.remove("active"));
    document
      .querySelectorAll(".tab-content")
      .forEach((content) => content.classList.remove("active"));

    // Add active class to selected tab and content
    document.querySelector(`[data-tab="${tabName}"]`)?.classList.add("active");
    document.getElementById(`${tabName}-tab`)?.classList.add("active");

    // Refresh Monaco editor when switching to editor tab
    if (tabName === "editor") {
      setTimeout(() => {
        this.mdEditor.layout();
      }, 100);
    }
  }

  private setupPasteHandling(): void {
    // Enhanced paste handling for web content
    this.editor.addEventListener("paste", async (event: ClipboardEvent) => {
      event.preventDefault();

      const clipboardData = event.clipboardData;
      if (!clipboardData) return;

      // Try to get HTML content first (preserves formatting)
      const htmlData = clipboardData.getData("text/html");
      if (htmlData) {
        // Process the HTML to clean it up
        const processedHtml = this.processPastedHtml(htmlData);

        // Insert the processed HTML at cursor position
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
        return;
      }

      // Fallback to plain text
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
      }
    });
  }

  private processPastedHtml(html: string): string {
    // Create a temporary DOM element to process the HTML
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = html;

    // Remove unwanted elements
    tempDiv
      .querySelectorAll("script, style, meta, link, noscript")
      .forEach((el) => el.remove());

    // Clean up attributes but keep essential ones
    tempDiv.querySelectorAll("*").forEach((el) => {
      const keepAttrs = ["href", "src", "alt", "title", "colspan", "rowspan"];
      const attrs = Array.from(el.attributes);
      attrs.forEach((attr) => {
        if (!keepAttrs.includes(attr.name)) {
          el.removeAttribute(attr.name);
        }
      });
    });

    // Convert Word-specific formatting to standard HTML
    tempDiv.querySelectorAll("[class^='Mso']").forEach((el) => {
      el.removeAttribute("class");
    });

    // Handle tables specifically
    tempDiv.querySelectorAll("table").forEach((table) => {
      // Ensure table has proper structure
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
    this.updateTimeout = setTimeout(callback, 300);
  }

  private updateMarkdown(): void {
    try {
      this.isUpdatingFromEditor = true;

      // Get HTML from editor
      const html = this.editor.innerHTML;

      // Convert to markdown using our advanced converter
      const markdown = this.converter.convert(html);

      // Update Monaco editor
      this.mdEditor.setValue(markdown);

      // Update preview
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

  private async updatePreview(): Promise<void> {
    try {
      const markdown = this.mdEditor.getValue();
      const previewElement = document.getElementById("markdown-preview");

      if (previewElement) {
        const html = await marked.parse(markdown);
        previewElement.innerHTML = html;
      }
    } catch (error) {
      console.error("Error updating preview:", error);
    }
  }

  private async copyMarkdown(): Promise<void> {
    const markdown = this.mdEditor.getValue();
    if (!markdown) return;

    try {
      await navigator.clipboard.writeText(markdown);

      // Show feedback
      const button = document.getElementById("copy-md") as HTMLButtonElement;
      const originalText = button.textContent;
      button.textContent = "Copied!";
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
    this.editor.innerHTML = "<p></p>";
    this.mdEditor.setValue("");
    document.getElementById("markdown-preview")!.innerHTML = "";
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

  // Public method to get current markdown
  public getMarkdown(): string {
    return this.mdEditor.getValue();
  }

  // Public method to set content
  public setContent(html: string): void {
    this.editor.innerHTML = html;
  }
}
