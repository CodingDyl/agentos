/**
 * Which npm script the browser check serves, and with which flags.
 *
 * A `dev` script that fans out with `concurrently` starts a back end as well
 * as the page (AgentOS: vite on a fixed port, plus its data server). Run
 * beside the owner's own copy of that project it fights for the same ports,
 * and if it did start it would use the owner's real state. When the project
 * has a front-end-only `dev:web`, the check serves that, on a free port.
 */
export function pickServeScript(scripts) {
  const dev = scripts.dev;
  if (typeof dev === "string" && /^\s*(npx\s+)?concurrently(\s|$)/.test(dev) && typeof scripts["dev:web"] === "string") return "dev:web";
  return ["dev", "start"].find((name) => typeof scripts[name] === "string");
}

export function serveFlags(body, port) {
  if (/^\s*next(\s|$)/.test(body)) return ` -- --port ${port} --hostname 127.0.0.1`;
  if (/^\s*vite(\s|$)/.test(body)) return ` -- --port ${port} --host 127.0.0.1 --strictPort`;
  return "";
}
