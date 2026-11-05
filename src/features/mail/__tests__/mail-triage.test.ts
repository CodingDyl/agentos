import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { activeAccountFilter, watchThreadLeaving } from "../mail-model";

/** A real observer, as `useMutation` holds one: `first` stays pending until released. */
function rapidCalls() {
  let refuse!: (failure: Error) => void;
  const first = new Promise<never>((_, reject) => (refuse = reject));
  const observer = new MutationObserver<unknown, Error, string>(new QueryClient(), {
    mutationFn: (threadId) => (threadId === "first" ? first : Promise.resolve({ succeeded: 1, failed: 0 })),
    retry: 0,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  return { observer, unsubscribe, refuse };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("watchThreadLeaving", () => {
  it("documents why: mutate's per-call callbacks miss a failure once a newer call started", async () => {
    const { observer, unsubscribe, refuse } = rapidCalls();
    const heard: string[] = [];

    void observer.mutate("first", { onError: () => heard.push("first") }).catch(() => undefined);
    void observer.mutate("second", { onSuccess: () => heard.push("second") });
    await flush();
    refuse(new Error("Gmail said no"));
    await flush();

    assert.deepEqual(heard, ["second"]);
    unsubscribe();
  });

  it("hears a failure from an earlier call in a rapid run", async () => {
    const { observer, unsubscribe, refuse } = rapidCalls();
    const refused: string[] = [];

    const first = watchThreadLeaving(observer.mutate("first"), "archive", (message) => refused.push(message));
    const second = watchThreadLeaving(observer.mutate("second"), "archive", (message) => refused.push(message));
    await flush();
    refuse(new Error("Gmail said no"));
    await Promise.all([first, second]);

    assert.deepEqual(refused, ["Gmail said no"]);
    unsubscribe();
  });

  it("treats a reported failure as a refusal, naming the action", async () => {
    const refused: string[] = [];
    await watchThreadLeaving(Promise.resolve({ succeeded: 0, failed: 1 }), "trash", (message) => refused.push(message));
    assert.deepEqual(refused, ["Gmail wouldn't move to Trash that thread. It's back in the list."]);
  });

  it("stays quiet when the thread left", async () => {
    const refused: string[] = [];
    await watchThreadLeaving(Promise.resolve({ succeeded: 1, failed: 0 }), "archive", (message) => refused.push(message));
    assert.deepEqual(refused, []);
  });

  it("falls back to its own words for a failure that isn't an Error", async () => {
    const refused: string[] = [];
    await watchThreadLeaving(Promise.reject("nope"), "archive", (message) => refused.push(message));
    assert.deepEqual(refused, ["Couldn't archive that thread."]);
  });
});

describe("activeAccountFilter", () => {
  it("keeps the choice while the Virtara mailbox is linked", () => {
    assert.equal(activeAccountFilter("titan", true), "titan");
    assert.equal(activeAccountFilter("gmail", true), "gmail");
  });

  it("drops any choice once unlinked, because the control is gone", () => {
    assert.equal(activeAccountFilter("titan", false), "all");
    assert.equal(activeAccountFilter("gmail", false), "all");
  });
});
