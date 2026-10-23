import assert from "node:assert/strict";
import test from "node:test";
import { continueVideo } from "./rooms.js";

test("continueVideo keeps the same clip's time for the next bingo", () => {
    const prev = { id: "abcdefghijk", title: "Dashcam", time: 90, playing: false, reportedAt: 0 };
    const next = { id: "abcdefghijk", title: "", time: 0, playing: false, reportedAt: 1 };
    const out = continueVideo(prev, next);
    assert.equal(out.time, 90);
    assert.equal(out.title, "Dashcam");
    assert.equal(continueVideo(prev, { ...next, id: "xxxxxxxxxx1" }).time, 0);
    assert.equal(continueVideo(prev, null), null);
});
