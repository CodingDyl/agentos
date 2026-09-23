import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readVision } from "../../hermes/capabilities";
import {
  buildReviewPacket,
  readDesignReview,
} from "../../hermes/design-review";

/**
 * Visual review, tested where it can be without a vision model.
 *
 * The risk here is not the images — it is everything around them: whether a
 * Hermes that cannot see is correctly refused, and whether a written review is
 * read back without observation and recommendation collapsing into each other.
 */

const reference = (path: string, filename: string) => ({
  assetId: `asset_${filename}`,
  path,
  filename,
  tags: [] as string[],
});

describe("deciding whether Hermes can look at anything", () => {
  const toolsets = (vision: Record<string, unknown> | undefined) => ({
    data: [
      { name: "web", enabled: true, configured: true },
      ...(vision ? [{ name: "vision", ...vision }] : []),
    ],
  });

  it("allows a review only when vision is enabled and configured", () => {
    assert.deepEqual(
      readVision(toolsets({ enabled: true, configured: true })),
      { vision: true },
    );
  });

  it("refuses when the toolset is enabled but has no model behind it", () => {
    // The failure this whole gate exists for. Hermes would accept the request
    // and return a confident design opinion formed without seeing anything,
    // and nothing in the answer would say so.
    const result = readVision(toolsets({ enabled: true, configured: false }));

    assert.equal(result.vision, false);
    assert.match(result.visionReason ?? "", /not configured/);
  });

  it("refuses when the toolset is switched off", () => {
    const result = readVision(toolsets({ enabled: false, configured: true }));

    assert.equal(result.vision, false);
    assert.match(result.visionReason ?? "", /disabled/);
  });

  it("refuses a Hermes with no vision toolset at all", () => {
    const result = readVision(toolsets(undefined));

    assert.equal(result.vision, false);
    assert.match(result.visionReason ?? "", /no vision toolset/);
  });

  it("fails closed on an answer it cannot read", () => {
    // An unreadable capability document must never enable a feature.
    for (const payload of [undefined, null, {}, { data: "nonsense" }, 42]) {
      assert.equal(readVision(payload).vision, false);
    }
  });
});

describe("what Hermes is asked", () => {
  const packet = () =>
    buildReviewPacket({
      project: "pantry-pilot",
      mode: "direction",
      question: "What direction should the Chef screen take?",
      references: [
        reference("/media/originals/a.png", "chef-a.png"),
        reference("/media/originals/b.png", "chef-b.png"),
      ],
      projectContext: "--- DECISIONS.md ---\nKeep the prompt format stable.",
    });

  it("sends the resolved paths, which is what the vision tool takes", () => {
    assert.match(packet(), /1\. \/media\/originals\/a\.png/);
    assert.match(packet(), /2\. \/media\/originals\/b\.png/);
  });

  it("insists the images are actually looked at", () => {
    // Without this the model will answer from filenames and project context,
    // which reads exactly like a real review.
    assert.match(packet(), /Inspect every reference with vision_analyze/);
    assert.match(packet(), /only what is actually visible/);
  });

  it("keeps observation and recommendation apart in the instructions", () => {
    assert.match(packet(), /separate from what you recommend/);
  });

  it("carries the project's own context and the operator's question", () => {
    assert.match(packet(), /Keep the prompt format stable/);
    assert.match(packet(), /What direction should the Chef screen take\?/);
  });
});

describe("reading a review back", () => {
  const reply = `# Design Review

## Direction

The references suggest a conversational, editorial mobile experience with
strong visual hierarchy and minimal interface chrome.

## Patterns

- **Large visual focal areas** — every reference leads with one dominant image
- **Restrained navigation** — chrome is hidden until needed
- Contextual actions appear beside content

## Recommendations

- Make Chef conversational first
- Keep recipe results visually dominant

## Avoid

- Dense dashboard layouts
- Too many simultaneous CTAs

## Implementation Notes

- Reuse the existing card surface

## Best Next Move

Create a focused Chef screen design brief.
`;

  it("reads the direction as prose and the lists as lists", () => {
    const review = readDesignReview(reply);

    assert.match(review.summary, /conversational, editorial mobile experience/);
    assert.equal(review.patterns.length, 3);
    assert.equal(review.recommendations.length, 2);
    assert.deepEqual(review.avoid, [
      "Dense dashboard layouts",
      "Too many simultaneous CTAs",
    ]);
    assert.deepEqual(review.implementationNotes, [
      "Reuse the existing card surface",
    ]);
    assert.match(review.bestNextMove ?? "", /Chef screen design brief/);
  });

  it("splits a bolded bullet into what it is and what it means", () => {
    const [first] = readDesignReview(reply).patterns;

    assert.equal(first.title, "Large visual focal areas");
    assert.match(first.detail, /leads with one dominant image/);
  });

  it("keeps a bullet whole when it has no natural title", () => {
    const third = readDesignReview(reply).patterns[2];

    // Inventing a division that is not there would be worse than showing the
    // line as it was written.
    assert.equal(third.title, third.detail);
    assert.match(third.title, /Contextual actions/);
  });

  it("never loses the reply it was given", () => {
    // The structured form is a reading, and when a reading is wrong the
    // original is the only way to find out.
    assert.equal(readDesignReview(reply).raw, reply);
  });

  it("still shows something when the headings are not the ones asked for", () => {
    const review = readDesignReview(
      "The references share a warm, editorial tone throughout.",
    );

    assert.match(review.summary, /warm, editorial tone/);
    assert.deepEqual(review.patterns, []);
  });

  it("tolerates a heading it was not expecting", () => {
    const review = readDesignReview(
      "## Design Direction\n\nA quiet, type-led layout.\n\n## Observations\n\n- Generous margins\n",
    );

    assert.match(review.summary, /quiet, type-led layout/);
    assert.equal(review.patterns[0].title, "Generous margins");
  });
});
