import assert from "node:assert/strict";
import test from "node:test";
import { rerollsFrom, canReroll } from "./rooms.js";

test("rerollsFrom keeps 0–9 and rejects the rest", () => {
    assert.equal(rerollsFrom(0), 0);
    assert.equal(rerollsFrom("3"), 3);
    assert.equal(rerollsFrom(9), 9);
    assert.equal(rerollsFrom(-1), null);
    assert.equal(rerollsFrom(10), null);
    assert.equal(rerollsFrom(1.5), null);
    assert.equal(rerollsFrom(undefined), null);
});

test("canReroll only before marks, wins, or using them up", () => {
    const room = { rerolls: 2 };
    const fresh = { marked: new Set(), bestLines: 0, rerollsUsed: 0 };
    assert.equal(canReroll(room, fresh), true);
    assert.equal(canReroll({ rerolls: 0 }, fresh), false);
    assert.equal(canReroll(room, { ...fresh, rerollsUsed: 2 }), false);
    assert.equal(canReroll(room, { ...fresh, marked: new Set([0]) }), false);
    assert.equal(canReroll(room, { ...fresh, bestLines: 1 }), false);
    assert.equal(canReroll(room, null), false);
});
