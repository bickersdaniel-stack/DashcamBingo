import assert from "node:assert/strict";
import test from "node:test";
import { roundSummary } from "./rooms.js";

test("roundSummary doesn't count a BINGO that was unmarked", () => {
    const room = {
        players: new Map([["u1", { id: "u1", name: "Sam", avatar: "", wins: 0 }]]),
        connections: new Map([["u1", 1]]),
        round: {
            number: 1, video: null,
            cards: new Map([["u1", { marked: new Set([0, 1, 2, 3]), bestLines: 0 }]]),
            events: [{ id: 1, type: "win", userId: "u1", lines: 1, videoTime: 10, undone: true }]
        }
    };
    let [row] = roundSummary(room).players;
    assert.equal(row.lines, 0);
    assert.equal(row.bingoAt, null);

    // Marking the line again counts, from the new time
    room.round.cards.get("u1").marked.add(4);
    room.round.events.push({ id: 2, type: "win", userId: "u1", lines: 1, videoTime: 20 });
    [row] = roundSummary(room).players;
    assert.equal(row.lines, 1);
    assert.equal(row.bingoAt, 20);
});
