# Web to Markdown

> Paste any rich web content — get clean, ready-to-use Markdown instantly.

**Live:** [tomd.vercel.app](https://tomd.vercel.app) &nbsp;|&nbsp; **Repo:** [github.com/emadjumaah/tomd](https://github.com/emadjumaah/tomd)

---

## What it does

Copy content from a web page, Google Doc, Notion, email or any rich-text source and paste it into the left panel. The right panel updates in real time with clean Markdown. You can then edit the Markdown directly, preview the rendered result, copy it to your clipboard, or download it as a `.md` file.

Everything runs in your browser — nothing is uploaded or stored.

## Features

- **Paste anything** — tables, headings, bold/italic, lists, code blocks, blockquotes, links and images all convert correctly
- **GitHub Flavored Markdown** — full GFM support including strikethrough and pipe tables
- **Monaco editor** — syntax-highlighted Markdown editing (the same engine that powers VS Code)
- **Live preview** — toggle to a rendered HTML preview at any time
- **Stats bar** — live word, character and line count
- **Copy / Download** — one-click copy to clipboard or save as `.md`
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
| [Monaco Editor](https://microsoft.github.io/monaco-editor/) | Syntax-highlighted Markdown editor |
| [marked](https://marked.js.org) | Markdown → HTML for the preview pane |
| [Vite](https://vitejs.dev) + TypeScript | Build tooling and type safety |

## Project structure

```
src/
  app.ts           Main app class — UI, paste handling, tab switching, stats
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
