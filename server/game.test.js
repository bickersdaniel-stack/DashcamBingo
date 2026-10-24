import assert from "node:assert/strict";
import test from "node:test";
import { applyCount } from "./rooms.js";
import { countCoin, countCoinsPerDay } from "./store.js";

const freshCard = () => ({ counts: Array(25).fill(0), peak: Array(25).fill(0), marked: new Set() });

test("applyCount marks from one up, unmarks at zero, and stays between 0 and 99", () => {
    const card = freshCard();
    assert.deepEqual(applyCount(card, 3, 1), { count: 1, marked: true, unmarked: false, coin: true });
    assert.ok(card.marked.has(3));
    assert.deepEqual(applyCount(card, 3, 1), { count: 2, marked: false, unmarked: false, coin: true });
    assert.deepEqual(applyCount(card, 3, -1), { count: 1, marked: false, unmarked: false, coin: false });
    assert.deepEqual(applyCount(card, 3, -1), { count: 0, marked: false, unmarked: true, coin: false });
    assert.ok(!card.marked.has(3));
    assert.equal(applyCount(card, 3, -1), null, "can't go below zero");
    card.counts[4] = card.peak[4] = 99;
    card.marked.add(4);
    assert.equal(applyCount(card, 4, 1), null, "can't go above 99");
});

test("applyCount only pays a coin for a new high, so taking one off and adding it back earns nothing", () => {
    const card = freshCard();
    applyCount(card, 0, 1);
    applyCount(card, 0, 1);
    applyCount(card, 0, -1);
    assert.equal(applyCount(card, 0, 1).coin, false, "back up to 2 again");
    assert.equal(applyCount(card, 0, 1).coin, true, "3 is new");
});

test("countCoin stops at the daily cap and starts again the next day", () => {
    const row = { wins: 0 };
    let total = 0;
    for (let i = 0; i < countCoinsPerDay + 10; i++) total += countCoin(row, "2026-10-24");
    assert.equal(total, countCoinsPerDay);
    assert.equal(row.coins, countCoinsPerDay);
    assert.equal(countCoin(row, "2026-10-25"), 1);
    assert.equal(row.coinsToday, 1);
});
