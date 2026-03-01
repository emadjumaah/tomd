// Ambient module declaration for turndown-plugin-gfm (no @types package available).
// Top-level imports must NOT appear here — use inline imports inside the block instead.
declare module "turndown-plugin-gfm" {
  import TurndownService from "turndown";

  interface TurndownPluginGfm {
    (turndownService: TurndownService): void;
  }
  const gfm: TurndownPluginGfm;
  export { gfm };
}
