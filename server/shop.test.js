import assert from "node:assert/strict";
import test from "node:test";
import { buyExtra, buySkin, lookOf, wearExtra } from "./shop.js";

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
