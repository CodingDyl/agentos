/** Screens the layout test checks for tokens and overflow. */
export const ROUTES = ["/", "/inbox", "/traction", "/business", "/finance", "/operator", "/workspaces", "/workspaces/pantry-pilot", "/knowledge", "/memory", "/learning", "/music", "/designs", "/taste", "/designs/boards", "/designs/generations", "/designs/motion", "/automations", "/connectors", "/activity", "/operations", "/operations?tab=specialists", "/workers", "/agent", "/compass", "/design-system"];

/** Further screens other tests open, so a first visit never happens mid-test. */
export const WARM_ONLY_ROUTES = ["/operator/runs", "/delivery", "/startups", "/coder", "/calendar", "/knowledge/library", "/connectors/vercel", "/traction?tab=find"];
