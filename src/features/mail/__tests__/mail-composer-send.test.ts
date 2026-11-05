import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MailComposer } from "../mail-composer";

describe("MailComposer", () => {
  it("has no submit button, so Enter in a field has nothing to press", () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(MailComposer, { target: { kind: "new" }, onClose: () => undefined, onDone: () => undefined }),
      ),
    );

    assert.match(html, />Send</);
    assert.doesNotMatch(html, /type="submit"/);
  });
});
