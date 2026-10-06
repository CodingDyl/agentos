import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRenderArgs,
  extractImageUrls,
  readRendererError,
} from "../renderer";

/**
 * The renderer, tested where it is guessing.
 *
 * The success path has never run on this machine — the account's plan refuses
 * to create jobs at all — so the response reading below was written without
 * ever seeing a real answer. That makes these tests the only thing standing
 * between a plausible-looking parser and one that silently returns nothing on
 * the first real generation.
 *
 * They pin the two properties that matter regardless of the exact payload: a
 * picture is found wherever it sits, and a prompt can never become a command.
 */

describe("finding rendered images in whatever comes back", () => {
  it("finds a URL nested anywhere in the response", () => {
    // Key names are guesses; the shape of the tree is not something to depend
    // on, so the reader walks it rather than indexing into it.
    const urls = extractImageUrls(
      JSON.stringify({
        job: {
          id: "abc",
          status: "completed",
          results: [{ some_unexpected_key: { url: "https://cdn.test/a.png" } }],
        },
      }),
    );

    assert.deepEqual(urls, ["https://cdn.test/a.png"]);
  });

  it("reads each job's result_url when the jobs are printed one per line", () => {
    const urls = extractImageUrls(
      [
        '{"event":"queued"}',
        '{"status":"completed","result_url":"https://cdn.test/one.jpg"}',
        '{"status":"completed","result_url":"https://cdn.test/two.webp"}',
      ].join("\n"),
    );

    assert.deepEqual(urls.sort(), [
      "https://cdn.test/one.jpg",
      "https://cdn.test/two.webp",
    ]);
  });

  it("saves one result per job, not its thumbnail or the references it was given", () => {
    // The shape that turned one requested image into two, and brought every
    // reference back into the library as a "generated" concept.
    const output = JSON.stringify([
      {
        id: "job-1",
        status: "completed",
        result_url: "https://cdn.test/result.png",
        thumbnail_url: "https://cdn.test/result-min.webp",
        min: { url: "https://cdn.test/result-min.png" },
        params: {
          prompt: "a poster",
          image_references: ["https://uploads.test/ref-a.jpg", "https://uploads.test/ref-b.png"],
        },
        medias: [{ url: "https://uploads.test/ref-a.jpg" }],
      },
    ]);

    assert.deepEqual(extractImageUrls(output), ["https://cdn.test/result.png"]);
  });

  it("keeps only the first plausible picture when no job names its result", () => {
    // Unknown shape: better one right image than every image in the payload.
    const output = JSON.stringify({
      job: { output: { url: "https://cdn.test/out.png" }, alt: "https://cdn.test/out-2.png" },
      input: { image: "https://uploads.test/ref.png" },
    });

    assert.deepEqual(extractImageUrls(output), ["https://cdn.test/out.png"]);
  });

  it("falls back to reading plain text when nothing parses", () => {
    // `--wait` is documented as printing result URLs, which may not be JSON.
    assert.deepEqual(
      extractImageUrls("Job finished.\nResult: https://cdn.test/out.png\n"),
      ["https://cdn.test/out.png"],
    );
  });

  it("keeps a signed URL whose extension precedes a query string", () => {
    assert.deepEqual(
      extractImageUrls('{"url":"https://cdn.test/a.png?sig=abc&exp=123"}'),
      ["https://cdn.test/a.png?sig=abc&exp=123"],
    );
  });

  it("ignores links that are plainly not pictures", () => {
    // A docs link or a dashboard URL in the response is not a result.
    assert.deepEqual(
      extractImageUrls(
        '{"docs":"https://higgsfield.ai/pricing","job":"https://app.test/jobs/1"}',
      ),
      [],
    );
  });

  it("returns nothing rather than guessing when there is no URL", () => {
    // The caller reports this honestly instead of recording an empty success.
    assert.deepEqual(extractImageUrls('{"status":"completed"}'), []);
    assert.deepEqual(extractImageUrls(""), []);
  });

  it("does not report the same image twice", () => {
    const urls = extractImageUrls(
      '{"url":"https://cdn.test/a.png","thumbnail":"https://cdn.test/a.png"}',
    );

    assert.deepEqual(urls, ["https://cdn.test/a.png"]);
  });
});

describe("what the renderer is actually run with", () => {
  it("passes the prompt as one argument, never as part of a command", () => {
    // The property that makes it safe to render an operator's own words.
    const args = buildRenderArgs({
      prompt: '"; rm -rf ~; echo "pwned',
    });

    assert.ok(args.includes('"; rm -rf ~; echo "pwned'));
    assert.equal(
      args.filter((arg) => arg.includes("rm -rf")).length,
      1,
      "the prompt must appear as exactly one argument",
    );
  });

  it("repeats the reference flag, which is how the CLI takes an array", () => {
    const args = buildRenderArgs({
      prompt: "a kitchen",
      referencePaths: ["/media/a.png", "/media/b.png"],
    });

    const references = args.filter((arg) => arg === "--image-references");
    assert.equal(references.length, 2);
    assert.ok(args.includes("/media/a.png"));
    assert.ok(args.includes("/media/b.png"));
  });

  it("waits for the job and asks for machine-readable output", () => {
    const args = buildRenderArgs({ prompt: "a kitchen" });

    assert.ok(args.includes("--wait"));
    assert.ok(args.includes("--json"));
  });

  it("omits the aspect ratio rather than inventing one", () => {
    assert.ok(!buildRenderArgs({ prompt: "a kitchen" }).includes("--aspect_ratio"));

    assert.ok(
      buildRenderArgs({ prompt: "a kitchen", aspectRatio: "9:16" }).includes(
        "9:16",
      ),
    );
  });
});

describe("explaining why a render failed", () => {
  it("turns the plan refusal into something an operator can act on", () => {
    // `job_minimum_basic_plan_required` tells a person nothing about what to
    // do next. The account can generate on some models and not others, so the
    // message names both ways out rather than only the one that costs money.
    const message = readRendererError(
      'Error: {"error_type":"job_minimum_basic_plan_required"}',
    );

    assert.match(message, /cannot create generations of that kind/);
    assert.match(message, /different model/);
    assert.match(message, /higher plan/);
  });

  it("names an expired session and what fixes it", () => {
    assert.match(readRendererError("401 Unauthorized"), /auth login/);
  });

  it("keeps an unfamiliar failure rather than summarising it away", () => {
    // The useful part of an unknown error is usually what a summary drops.
    assert.match(
      readRendererError("some novel backend explosion"),
      /some novel backend explosion/,
    );
  });
});
