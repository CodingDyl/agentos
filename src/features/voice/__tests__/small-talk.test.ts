import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { smallTalkReply } from "../small-talk";

const at = (hour: number, minute = 0) => new Date(2026, 8, 30, hour, minute);
const first = () => 0;

describe("Jarvis's small talk", () => {
  it("answers good morning in the morning, in his own voice", () => {
    assert.equal(smallTalkReply("Good morning", { now: at(8), random: first }), "Good morning, sir. What are we conquering today?");
    assert.equal(smallTalkReply("Morning, Jarvis!", { now: at(8), random: first }), "Good morning, sir. What are we conquering today?");
  });

  it("mentions what's waiting on you", () => {
    assert.equal(smallTalkReply("good morning jarvis", { now: at(9), waiting: 2, random: first }), "Good morning, sir. Two things are waiting on you. What are we conquering today?");
    assert.match(smallTalkReply("hello", { now: at(9), waiting: 1, random: first }) ?? "", /One thing is waiting on you\./);
  });

  it("notices the wrong time of day", () => {
    assert.match(smallTalkReply("Good morning", { now: at(15), random: first }) ?? "", /^Good afternoon, technically, sir\./);
    assert.match(smallTalkReply("Good morning", { now: at(2, 30), random: first }) ?? "", /^It's 2:30, sir\. Still, good morning to you\./);
  });

  it("answers just his name, thanks, and goodbye", () => {
    assert.match(smallTalkReply("Hey Jarvis", { now: at(10), random: first }) ?? "", /^Good morning, sir\./);
    assert.equal(smallTalkReply("Thanks Jarvis", { now: at(10), random: first }), "Always a pleasure, sir.");
    assert.equal(smallTalkReply("Good night", { now: at(23), random: first }), "Good night, sir. I'll keep an eye on things.");
    assert.equal(smallTalkReply("You there?", { now: at(10), random: first }), "Always, sir.");
  });

  it("leaves anything with a request in it to Hermes", () => {
    assert.equal(smallTalkReply("Good morning, plan my day", { now: at(8) }), undefined);
    assert.equal(smallTalkReply("Thanks, now deploy Pantry Pilot", { now: at(8) }), undefined);
    assert.equal(smallTalkReply("What's on my calendar?", { now: at(8) }), undefined);
  });
});
