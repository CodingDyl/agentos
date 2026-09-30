import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import type { VaultState, VaultStatus } from "../../shared/memory-types";
import { isExcluded, memoryCacheDir, memoryVaultPath, probeVault } from "./config";
import { MemoryIndex } from "./index";

/**
 * Keeps the memory index in step with the vault.
 *
 * Three signals, because each one misses something:
 *
 * - **A file watcher** (debounced) — the normal path, so an edit saved in
 *   Obsidian shows up here in about a second.
 * - **An availability probe** every few seconds — the vault is on an external
 *   drive. When it disappears the watcher is dropped and the index is kept
 *   but marked stale; when it comes back it is re-indexed and watched again.
 * - **A periodic reconcile** — cheap (stat only, re-reading changed files) and
 *   catches anything a watcher dropped.
 */

export interface MemoryServiceOptions {
  root?: string;
  cacheFile?: string;
  probeMs?: number;
  reconcileMs?: number;
  debounceMs?: number;
}

export class MemoryService {
  readonly root: string;
  readonly index: MemoryIndex;
  private readonly cacheFile: string;
  private readonly options: Required<Pick<MemoryServiceOptions, "probeMs" | "reconcileMs" | "debounceMs">>;

  private state: VaultState = "indexing";
  private reason?: string;
  private stale = true;
  private version = 0;
  private checkedAt = new Date().toISOString();

  private watcher?: FSWatcher;
  private timers: NodeJS.Timeout[] = [];
  private debounce?: NodeJS.Timeout;
  private touched = new Set<string>();
  private running: Promise<void> = Promise.resolve();
  private started = false;
  private readonly listeners = new Set<() => void>();

  constructor(options: MemoryServiceOptions = {}) {
    this.root = path.resolve(options.root ?? memoryVaultPath());
    this.cacheFile = options.cacheFile ?? path.join(memoryCacheDir(), "index.json");
    this.index = new MemoryIndex(this.root);
    this.options = {
      probeMs: options.probeMs ?? 3_000,
      reconcileMs: options.reconcileMs ?? 30_000,
      debounceMs: options.debounceMs ?? 250,
    };
  }

  /** Loads the cache, indexes if the vault is there, and starts watching. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    if (await this.index.loadCache(this.cacheFile)) {
      this.version += 1;
    }

    await this.check();

    this.timers.push(setInterval(() => void this.check(), this.options.probeMs));
    this.timers.push(
      setInterval(() => {
        if (this.state === "connected") void this.reindex();
      }, this.options.reconcileMs),
    );
    for (const timer of this.timers) timer.unref();
  }

  stop() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    if (this.debounce) clearTimeout(this.debounce);
    this.watcher?.close();
    this.watcher = undefined;
    this.started = false;
  }

  /** Called whenever the index changes. Returns an unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isAvailable(): boolean {
    return this.state === "connected" && !this.stale;
  }

  status(): VaultStatus {
    return {
      state: this.state,
      root: this.root,
      reason: this.reason,
      checkedAt: this.checkedAt,
      lastIndexedAt: this.index.lastIndexedAt,
      version: this.version,
      stale: this.stale,
      ...this.index.counts(),
    };
  }

  /** Probes the vault and reacts to it arriving or leaving. */
  async check(): Promise<void> {
    const probe = await probeVault(this.root);
    this.checkedAt = new Date().toISOString();

    if (!probe.available) {
      const wasAvailable = this.state !== "unavailable" && this.state !== "unconfigured";
      this.watcher?.close();
      this.watcher = undefined;
      this.state = probe.configured ? "unavailable" : "unconfigured";
      this.reason = probe.reason;
      if (!this.stale || wasAvailable) {
        this.stale = true;
        this.bump();
      }
      return;
    }

    if (this.state === "connected" && this.watcher) return;

    // Arrived (at boot, or the drive was plugged back in): index, then watch.
    this.state = "indexing";
    this.reason = undefined;
    await this.reindex();
    if ((await probeVault(this.root)).available) {
      this.state = "connected";
      this.stale = false;
      this.watch();
      this.bump();
    }
  }

  /** Serialised: a reindex asked for during another waits for it. */
  reindex(touched: ReadonlySet<string> = new Set()): Promise<void> {
    const next = this.running.then(async () => {
      try {
        const changed = await this.index.refresh(touched);
        if (changed) {
          this.bump();
          await this.index.saveCache(this.cacheFile).catch((error) => {
            console.error("[memory] could not save the index cache:", error);
          });
        }
      } catch (error) {
        // Most likely the drive went away mid-walk; the probe will say so.
        console.error("[memory] reindex failed:", (error as Error).message);
        void this.check();
      }
    });
    this.running = next;
    return next;
  }

  private watch() {
    this.watcher?.close();
    try {
      this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
        if (filename) {
          const relative = filename.toString().split(path.sep).join("/");
          if (isExcluded(relative)) return;
          this.touched.add(relative);
        }
        this.schedule();
      });
      this.watcher.on("error", () => {
        this.watcher?.close();
        this.watcher = undefined;
        void this.check();
      });
    } catch (error) {
      console.error("[memory] could not watch the vault; relying on reconcile:", (error as Error).message);
    }
  }

  private schedule() {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      const touched = this.touched;
      this.touched = new Set();
      void this.reindex(touched);
    }, this.options.debounceMs);
  }

  private bump() {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

let shared: MemoryService | undefined;

/** The process-wide memory service. Started by the server at boot. */
export function memoryService(): MemoryService {
  shared ??= new MemoryService();
  return shared;
}
