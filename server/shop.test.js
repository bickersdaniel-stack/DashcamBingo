import assert from "node:assert/strict";
import test from "node:test";
import { buyExtra, buySkin, claimDaily, dailyStatus, lookOf, wearExtra } from "./shop.js";

const card = { id: "c1" };

test("buySkin charges the rarity's price, puts a card's first skin on, and refuses repeats and short pockets", () => {
    const profile = { coins: 2000 };
    assert.match(buySkin(profile, card, "nope").error, /doesn't exist/);
    assert.match(buySkin(profile, null, "gold").error, /doesn't exist/);
    const gold = buySkin(profile, card, "gold");
    assert.equal(gold.coins, 500, "legendary costs 1500");
    assert.deepEqual(profile.skins.c1, { owned: ["gold"], equipped: "gold" });
    assert.match(buySkin(profile, card, "gold").error, /already own/);
    assert.equal(buySkin(profile, card, "neon").equipped, "gold", "the worn skin stays on");
    assert.equal(profile.coins, 200);
    assert.match(buySkin(profile, card, "holo").error, /costs 600/);
    assert.equal(profile.coins, 200, "nothing taken");
    assert.equal(profile.stats.skins, 2);
    assert.equal(profile.stats.legendaries, undefined, "buying isn't rolling");
    assert.equal(buySkin({ coins: 0 }, card, "matte").error, "That skin costs 150 coins.");
});

test("buyExtra puts it straight on an empty slot, and wearExtra only wears what you own, in its own slot", () => {
    const profile = { coins: 500 };
    assert.match(buyExtra(profile, "nope").error, /isn't in the shop/);
    assert.deepEqual(buyExtra(profile, "gold-ring"), { coins: 200, owned: ["gold-ring"], wearing: { frame: "gold-ring" } });
    assert.match(buyExtra(profile, "gold-ring").error, /already own/);
    assert.match(buyExtra(profile, "police-lights").error, /costs 600/);
    profile.coins += 1000;
    buyExtra(profile, "backseat-driver");
    buyExtra(profile, "hazard-tape");
    assert.equal(profile.wearing.frame, "gold-ring", "a full slot stays as it was");
    assert.deepEqual(lookOf(profile), { frame: "gold-ring", title: "Backseat driver", banner: null });
    assert.match(wearExtra(profile, "frame", "police-lights").error, /don't own/);
    assert.match(wearExtra(profile, "title", "hazard-tape").error, /don't own/, "a frame isn't a title");
    assert.match(wearExtra(profile, "coins", null).error, /can't be worn/);
    wearExtra(profile, "frame", "hazard-tape");
    wearExtra(profile, "title", null);
    assert.deepEqual(lookOf(profile), { frame: "hazard-tape", title: null, banner: null });
});

test("claimDaily walks the 7 stops on days in a row, once a day, and starts over after day 7 or a missed day", () => {
    const profile = { coins: 0 };
    assert.deepEqual(dailyStatus(profile, "2026-10-01"), { rewards: [10, 15, 20, 25, 30, 40, 100], claimed: false, done: 0 });
    assert.equal(claimDaily(profile, "2026-10-01").gained, 10);
    assert.match(claimDaily(profile, "2026-10-01").error, /Come back tomorrow/);
    const days = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"];
    assert.deepEqual(days.map(day => claimDaily(profile, day).gained), [15, 20, 25, 30, 40, 100], "across a month end too");
    assert.equal(profile.coins, 240);
    assert.deepEqual(dailyStatus(profile, "2026-10-07"), { rewards: [10, 15, 20, 25, 30, 40, 100], claimed: true, done: 7 });
    assert.equal(dailyStatus(profile, "2026-10-08").done, 0, "a full week starts over");
    claimDaily(profile, "2026-10-08");
    claimDaily(profile, "2026-10-09");
    assert.equal(dailyStatus(profile, "2026-10-10").done, 2);
    assert.equal(dailyStatus(profile, "2026-10-11").done, 0, "a missed day starts over");
    assert.equal(claimDaily(profile, "2026-10-11").gained, 10);
    profile.daily = { day: "2026-03-31", step: 3 };
    assert.equal(dailyStatus(profile, "2026-04-01").done, 3, "the day before works across a month boundary");
});
