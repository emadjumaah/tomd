import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

export class AdvancedHtmlToMarkdown {
  private turndownService: TurndownService;

  constructor() {
    this.turndownService = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      strongDelimiter: "**",
      emDelimiter: "*",
      linkStyle: "inlined",
    });

    // Add GFM support (GitHub Flavored Markdown) - handles tables, strikethrough, etc.
    this.turndownService.use(gfm);
  }

  convert(html: string): string {
    try {
      // Pre-process HTML to clean it up
      const processedHtml = this.preprocessHtml(html);

      // Convert to markdown using proven Turndown with GFM
      let markdown = this.turndownService.turndown(processedHtml);

      // Minimal post-processing for cleanup
      markdown = this.postprocessMarkdown(markdown);

      return markdown;
    } catch (error) {
      console.error("Error converting HTML to Markdown:", error);
      return "# Conversion Error\n\nThere was an error converting the HTML content.";
    }
  }

  private preprocessHtml(html: string): string {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = html;

    // Remove unwanted elements
    tempDiv
      .querySelectorAll("script, style, meta, link, noscript")
      .forEach((el) => el.remove());

    // Fix malformed tables - add missing structure
    tempDiv.querySelectorAll("table").forEach((table) => {
      const hasThead = table.querySelector("thead") !== null;
      const hasTh = table.querySelector("th") !== null;

      // If table has th elements but no thead, create thead from first tr with th
      if (!hasThead && hasTh) {
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

  private postprocessMarkdown(markdown: string): string {
    return markdown
      .replace(/\n{3,}/g, "\n\n") // Reduce multiple newlines to 2
      .replace(/^\s+|\s+$/g, ""); // Trim leading/trailing whitespace
    // NOTE: do NOT collapse multiple spaces — that would corrupt code block indentation
  }
}
