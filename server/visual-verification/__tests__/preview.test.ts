import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { freePort, PreviewError, resolvePreviewCommand } from "../preview";

/**
 * Nothing here starts a server — that needs a real project and a real browser.
 * What is worth testing without either is the decision that comes first: which
 * command serves this worktree, and what happens when nothing does.
 *
 * A project that cannot be started must fail loudly with a reason, because that
 * reason is what an operator sees on an `unverifiable` verdict.
 */

async function worktreeWith(
  directory: string,
  name: string,
  manifest: unknown,
): Promise<string> {
  const target = path.join(directory, name);

  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(
    path.join(target, "package.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  return target;
}

describe("choosing how to serve a worktree", () => {
  let directory: string;
  let previous: string | undefined;

  before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-preview-"));
    previous = process.env.AGENTOS_VISUAL_PREVIEW_COMMAND;
    delete process.env.AGENTOS_VISUAL_PREVIEW_COMMAND;
  });

  after(async () => {
    if (previous === undefined) {
      delete process.env.AGENTOS_VISUAL_PREVIEW_COMMAND;
    } else {
      process.env.AGENTOS_VISUAL_PREVIEW_COMMAND = previous;
    }

    await fs.rm(directory, { recursive: true, force: true });
  });

  it("prefers the script that serves pages over the one that serves everything", async () => {
    // A `dev` that supervises an API and a front end together cannot be given
    // a port; the half that serves pages can.
    const worktree = await worktreeWith(directory, "both", {
      scripts: { dev: "concurrently dev:data dev:web", "dev:web": "vite" },
    });

    const { command, script } = await resolvePreviewCommand(worktree, 5310);

    assert.equal(script, "dev:web");
    assert.match(command, /npm run dev:web -- --port 5310/);
  });

  it("falls back to `dev` when that is all there is", async () => {
    const worktree = await worktreeWith(directory, "dev-only", {
      scripts: { dev: "next dev" },
    });

    const { script } = await resolvePreviewCommand(worktree, 5311);

    assert.equal(script, "dev");
  });

  it("lets an explicit command win, and fills the port into it", async () => {
    process.env.AGENTOS_VISUAL_PREVIEW_COMMAND = "make serve PORT={port}";

    try {
      const worktree = await worktreeWith(directory, "custom", {
        scripts: { dev: "vite" },
      });

      const { command, script } = await resolvePreviewCommand(worktree, 5312);

      assert.equal(command, "make serve PORT=5312");
      assert.equal(script, undefined);
    } finally {
      delete process.env.AGENTOS_VISUAL_PREVIEW_COMMAND;
    }
  });

  it("says what to do when no script serves anything", async () => {
    const worktree = await worktreeWith(directory, "no-scripts", {
      scripts: { test: "node --test" },
    });

    await assert.rejects(
      () => resolvePreviewCommand(worktree, 5313),
      (error: unknown) => {
        assert.ok(error instanceof PreviewError);
        assert.match(error.message, /AGENTOS_VISUAL_PREVIEW_COMMAND/);
        return true;
      },
    );
  });

  it("says what to do when there is no manifest at all", async () => {
    const worktree = path.join(directory, "empty");
    await fs.mkdir(worktree, { recursive: true });

    await assert.rejects(
      () => resolvePreviewCommand(worktree, 5314),
      (error: unknown) => {
        assert.ok(error instanceof PreviewError);
        assert.match(error.message, /package\.json/);
        return true;
      },
    );
  });
});

describe("picking a port", () => {
  it("asks the operating system rather than guessing", async () => {
    // Two verifications running at once must not land on the same port, which
    // a fixed or random choice cannot promise.
    const [first, second] = await Promise.all([freePort(), freePort()]);

    assert.ok(first > 0 && second > 0);
    assert.notEqual(first, second);
  });
});
