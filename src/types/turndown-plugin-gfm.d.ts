import TurndownService from "turndown";

declare module "turndown-plugin-gfm" {
  interface TurndownPluginGfm {
    (turndownService: TurndownService): void;
  }
  const gfm: TurndownPluginGfm;
  export default gfm;
}
