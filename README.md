# Web to Markdown

> Convert both ways — paste rich web content to get clean Markdown, or paste Markdown to get a rendered web view and HTML.

**Live:** [tomd.vercel.app](https://tomd.vercel.app) &nbsp;|&nbsp; **Repo:** [github.com/emadjumaah/tomd](https://github.com/emadjumaah/tomd)

---

## What it does

A bidirectional converter with a direction toggle in the header.

**HTML → MD** — copy content from a web page, Google Doc, Notion, email or any rich-text source and paste it into the left panel. The right panel updates in real time with clean Markdown. You can edit the Markdown directly, preview the rendered result, copy it to your clipboard, or download it as a `.md` file.

**MD → Web** — paste or type Markdown on the left and get a live rendered **web view** on the right, plus an **HTML** tab with the generated source. Copy the HTML to your clipboard or download a complete, self-contained `.html` document.

Everything runs in your browser — nothing is uploaded or stored.

## Features

- **Two directions** — switch between HTML → Markdown and Markdown → Web with one click
- **Paste anything** — tables, headings, bold/italic, lists, code blocks, blockquotes, links and images all convert correctly
- **GitHub Flavored Markdown** — full GFM support including strikethrough and pipe tables
- **Monaco editor** — syntax-highlighted editing (the same engine that powers VS Code)
- **Live preview** — see the rendered HTML result update as you type
- **HTML export** — copy the generated HTML or download a standalone, styled `.html` page
- **Undo / redo** — full history in the rich-text editor (`Ctrl/Cmd+Z`, `Ctrl+Y`)
- **Stats bar** — live word, character and line count
- **Copy / Download** — one-click copy to clipboard or save as `.md` / `.html`
- **No server, no tracking** — 100% client-side

## Getting started

```bash
npm install
npm run dev       # dev server at http://localhost:5173
npm run build     # production build → dist/
npm run preview   # preview the production build locally
```

## Tech stack

| Library | Purpose |
|---|---|
| [Turndown](https://github.com/mixmark-io/turndown) + [turndown-plugin-gfm](https://github.com/laurent22/turndown-plugin-gfm) | HTML → Markdown conversion |
| [marked](https://marked.js.org) | Markdown → HTML for the preview pane and the Markdown → Web mode |
| [Monaco Editor](https://microsoft.github.io/monaco-editor/) | Syntax-highlighted Markdown editor |
| [Vite](https://vitejs.dev) + TypeScript | Build tooling and type safety |

## Project structure

```
src/
  app.ts           Main app class — UI, mode toggle, paste handling, both conversion directions, stats
  converter.ts     HTML → Markdown (Turndown wrapper with pre/post-processing)
  main.ts          Entry point
  types/
    turndown-plugin-gfm.d.ts   Ambient type declaration for the GFM plugin

public/
  favicon.svg      SVG favicon

index.html         Single-page shell + all CSS styles
vite.config.ts     Build config (Monaco split into its own chunk)
```

## License

MIT
