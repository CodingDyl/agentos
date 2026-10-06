import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chooseBrandImages, MAX_BRAND_PHOTOS, summariseColors, summariseFonts, toHex } from "../brand";
import { sniffImage, type CaptureResult, type CapturedImage, type CapturedPage } from "../capture";

const manifest: CaptureResult["manifest"] = { startUrl: "https://a.example/", capturedAt: "2026-10-05T09:00:00.000Z", robots: "obeyed", captured: [], skipped: [], failed: [] };

function image(url: string, bytes: number[], extra: Partial<CapturedImage> = {}): CapturedImage {
  return { url, placement: "content", width: 800, height: 600, data: Buffer.from([0x89, 0x50, 0x4e, 0x47, ...bytes]), contentType: "image/png", ...extra };
}

function page(url: string, brand: CapturedPage["brand"]): CapturedPage {
  return { url, headings: [], navigation: [], ctas: [], forms: [], images: 0, imagesWithoutAlt: 0, text: "", internalLinks: [], brand };
}

describe("brand kit", () => {
  it("tells file types by their bytes, not their name", () => {
    assert.equal(sniffImage(Buffer.from("89504e470d0a1a0a0000", "hex")), "image/png");
    assert.equal(sniffImage(Buffer.from("ffd8ffe000104a46", "hex")), "image/jpeg");
    assert.equal(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
    assert.equal(sniffImage(Buffer.from('<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')), "image/svg+xml");
    assert.equal(sniffImage(Buffer.from("<html><script>alert(1)</script></html>")), undefined);
    assert.equal(sniffImage(Buffer.from("GIF89a")), "image/gif");
  });

  it("turns computed colours into hex and drops the transparent ones", () => {
    assert.equal(toHex("rgb(232, 93, 4)"), "#e85d04");
    assert.equal(toHex("rgba(0, 0, 0, 0)"), undefined);
    assert.equal(toHex("rgba(10, 20, 30, 0.9)"), "#0a141e");
    assert.equal(toHex("rgb(10 20 30 / 40%)"), undefined);
    assert.equal(toHex("color(display-p3 1 0 0)"), undefined);
  });

  it("keeps each role's leading colour ahead of a busy one", () => {
    const text = Array.from({ length: 12 }, () => ({ value: "rgb(20, 20, 20)", role: "text" as const }));
    const colors = summariseColors([...text, { value: "rgb(232, 93, 4)", role: "accent" }, { value: "rgb(255, 255, 255)", role: "background" }]);
    assert.deepEqual(colors.map((color) => color.hex), ["#e85d04", "#ffffff", "#141414"]);
    assert.equal(colors[2].weight, 12);
  });

  it("names the first real font of each stack, once", () => {
    assert.deepEqual(
      summariseFonts([
        { family: '-apple-system, "Open Sans", sans-serif', role: "body" },
        { family: "'Open Sans', Arial", role: "body" },
        { family: "Playfair Display, serif", role: "heading" },
        { family: "sans-serif", role: "heading" },
        { family: "x}</style><script>", role: "heading" },
      ]),
      [
        { family: "Open Sans", role: "body" },
        { family: "Playfair Display", role: "heading" },
      ],
    );
  });

  it("prefers a header logo, ranks photos by how many pages show them, and stores each file once", () => {
    const shared = image("https://a.example/team.jpg", [1], { width: 900, height: 600 });
    const capture: CaptureResult = {
      manifest,
      pages: [
        page("https://a.example/", {
          logos: [image("https://a.example/icon.png", [9], { placement: "icon" }), image("https://a.example/logo.png", [8], { placement: "header" })],
          photos: [image("https://a.example/big.jpg", [2], { width: 2000, height: 1200 }), shared, image("https://a.example/tiny.jpg", [3], { width: 120, height: 90 })],
          colors: [],
          fonts: [],
        }),
        page("https://a.example/about", {
          logos: [],
          // Same address, no bytes this time: the photo was downloaded on the first page.
          photos: [{ ...shared, data: undefined }, image("https://cdn.example/team-copy.jpg", [1])],
          colors: [],
          fonts: [],
        }),
      ],
    };
    const chosen = chooseBrandImages(capture);
    assert.deepEqual(chosen.map((entry) => [entry.name, entry.image.url]), [
      ["logo", "https://a.example/logo.png"],
      ["logo-2", "https://a.example/icon.png"],
      ["photo-01", "https://a.example/team.jpg"],
      ["photo-02", "https://a.example/big.jpg"],
    ]);
  });

  it("caps the photos", () => {
    const photos = Array.from({ length: MAX_BRAND_PHOTOS + 5 }, (_, index) => image(`https://a.example/${index}.jpg`, [index]));
    const chosen = chooseBrandImages({ manifest, pages: [page("https://a.example/", { logos: [], photos, colors: [], fonts: [] })] });
    assert.equal(chosen.length, MAX_BRAND_PHOTOS);
  });
});
