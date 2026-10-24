import assert from "node:assert/strict";
import test from "node:test";
import { react } from "./rooms.js";
import { reactionsOf } from "./shop.js";

test("react toggles emojis people own on spots, wins and achievements, up to 8 different ones", () => {
    const allowed = reactionsOf({ extras: ["aussie-pack", "gold-ring"] });
    assert.deepEqual(allowed, ["👍", "😂", "😮", "🦘", "🐨", "🍺", "🔥"]);
    const event = { type: "spot" };
    assert.equal(react(event, "a", "🦘", allowed), true);
    assert.equal(react(event, "b", "🦘", allowed), true);
    assert.deepEqual(event.reactions, { "🦘": ["a", "b"] });
    react(event, "a", "🦘", allowed);
    assert.deepEqual(event.reactions, { "🦘": ["b"] }, "a second tap takes yours off");
    react(event, "b", "🦘", allowed);
    assert.deepEqual(event.reactions, {}, "nobody left, so the emoji goes");
    assert.equal(react(event, "a", "🤬", allowed), false, "not in a pack they own");
    assert.equal(react(event, "a", "__proto__", allowed), false);
    assert.equal(react({ type: "host" }, "a", "👍", allowed), false, "only spots, wins and achievements");
    assert.equal(react(undefined, "a", "👍", allowed), false, "an event that fell out of the feed");
    const full = { type: "win", reactions: Object.fromEntries(["1", "2", "3", "4", "5", "6", "7", "8"].map(k => [k, ["x"]])) };
    assert.equal(react(full, "a", "👍", allowed), false, "8 different already");
    assert.equal(react(full, "x", "1", ["1"]), true, "taking one off still works");
});
