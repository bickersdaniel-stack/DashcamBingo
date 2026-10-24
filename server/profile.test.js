import assert from "node:assert/strict";
import test from "node:test";
import { profileOf } from "./leaderboard.js";

const cards = [{ id: "c1", text: "Ute", description: "", pack: "core" }];
const packs = [{ id: "core", name: "Core" }];

test("profileOf shows earned achievements only, the showcased card in its skin, and nobody blocked", () => {
    const profiles = {
        a: { name: "Sam", wins: 3, achievements: { "first-blood": 1, "hat-trick": 2 }, showcase: "c1", skins: { c1: { owned: ["gold", "neon"], equipped: "gold" } } },
        b: { name: "Jo", wins: 5, blocked: true },
        c: { name: "Al", wins: 0, showcase: "deleted" }
    };
    const sam = profileOf("a", profiles, cards, packs);
    assert.deepEqual(sam.achievements.map(a => a.name), ["Hat trick", "First blood"], "newest first, nothing unearned");
    assert.equal(sam.rank, 1, "the blocked player doesn't place");
    assert.equal(sam.skins, 2);
    assert.deepEqual(sam.showcase, { text: "Ute", description: "", pack: "core", packName: "Core", skin: { id: "gold", name: "Gold foil", rarity: "legendary" } });
    assert.equal(profileOf("b", profiles, cards, packs), null);
    assert.equal(profileOf("c", profiles, cards, packs).showcase, null, "a deleted card shows nothing");
    assert.equal(profileOf("c", profiles, cards, packs).rank, null, "no win, no place");
    assert.equal(profileOf("__proto__", profiles, cards, packs), null);
    assert.equal(profileOf("nobody", profiles, cards, packs), null);
});
