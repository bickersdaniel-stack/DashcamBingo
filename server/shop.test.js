import assert from "node:assert/strict";
import test from "node:test";
import { buySkin } from "./shop.js";

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
