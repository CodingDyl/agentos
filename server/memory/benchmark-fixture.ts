import fs from "node:fs/promises";
import path from "node:path";

/**
 * A synthetic vault for benchmarking: `notes` notes across folders, with
 * roughly `edges` distinct links between them, a few hubs, some orphans and
 * some unresolved targets — the shape of a real vault, at a known size.
 *
 * `npx tsx server/memory/benchmark-fixture.ts <dir> [notes] [edges]`
 */
export async function writeBenchmarkVault(root: string, notes = 1_000, edges = 3_000): Promise<void> {
  const folders = ["projects/alpha", "projects/beta", "projects/gamma", "areas/health", "areas/money", "me", "logs/daily", "archive"];
  // Deterministic pseudo-random, so every run measures the same vault.
  let seed = 42;
  const random = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);

  const ids = Array.from({ length: notes }, (_, n) => `${folders[n % folders.length]}/note-${String(n).padStart(4, "0")}`);
  const outgoing = ids.map(() => new Set<number>());
  let made = 0;
  while (made < edges) {
    // A few hub notes attract a disproportionate share of links.
    const target = random() < 0.2 ? Math.floor(random() * 10) : Math.floor(random() * notes);
    const source = Math.floor(random() * notes);
    if (source === target || source % 97 === 0 || outgoing[source].has(target)) continue;
    outgoing[source].add(target);
    made += 1;
  }

  for (const [n, id] of ids.entries()) {
    const links = [...outgoing[n]].map((target) => `- [[${ids[target].split("/").pop()}]]`);
    if (n % 50 === 0) links.push(`- [[missing-${n}]]`);
    const body = `---\ntags: [${folders[n % folders.length].split("/")[0]}]\n---\n# Note ${n}\n\nSome text about topic ${n % 17}.\n\n## Links\n${links.join("\n")}\n`;
    const file = path.join(root, `${id}.md`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body, "utf8");
  }
}

if (process.argv[1]?.endsWith("benchmark-fixture.ts")) {
  const [dir, notes, edges] = process.argv.slice(2);
  if (!dir) throw new Error("Usage: benchmark-fixture.ts <dir> [notes] [edges]");
  await writeBenchmarkVault(path.resolve(dir), Number(notes) || undefined, Number(edges) || undefined);
  console.log(`Wrote a benchmark vault to ${dir}`);
}
