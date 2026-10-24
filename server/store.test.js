import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cardTable, countSpot, getProfile, markDealt, profileTable, updateProfile } from "./store.js";

test("updateProfile writes what change() did, but nothing when it returns an error", () => {
    updateProfile("t1", profile => { profile.coins = 5; });
    assert.deepEqual(getProfile("t1"), { wins: 0, coins: 5 });
    assert.deepEqual(updateProfile("t1", profile => { profile.coins = 0; return { error: "no" }; }), { error: "no" });
    assert.equal(getProfile("t1").coins, 5, "unchanged");
    updateProfile("t2", () => ({ error: "no" }));
    assert.equal(getProfile("t2"), undefined, "no empty profile left behind");
    profileTable.remove("t1");
});

test("countSpot and markDealt add to a card's numbers, never below zero, and skip deleted cards", () => {
    cardTable.put("k1", { id: "k1", dealt: 0, spotted: 0, counted: 0 });
    markDealt(["k1", "gone"]);
    countSpot("k1", 1, 1);
    countSpot("k1", -1, -5);
    countSpot("gone", 1, 1);
    assert.deepEqual(cardTable.get("k1"), { id: "k1", dealt: 1, spotted: 0, counted: 0 });
    assert.equal(cardTable.get("gone"), undefined);
    cardTable.remove("k1");
});

// A real start against a folder holding an old store.json, in its own process, twice
test("the first start imports store.json once, then renames it so it's never read again", () => {
    const dir = mkdtempSync(join(tmpdir(), "bingo-"));
    writeFileSync(join(dir, "store.json"), JSON.stringify({
        suggestions: [{ id: "s1", text: "Roo", by: { id: "u1", name: "Sam" }, status: "pending" }],
        profiles: { u1: { wins: 2, coins: 40, skins: { c1: { owned: ["gold"], equipped: "gold" } } } },
        packs: [{ id: "core", name: "Core", description: "", on: true }],
        cards: [{ id: "c1", text: "Ute", description: "", pack: "core", dealt: 3, spotted: 1, counted: 2 }],
        settings: { bingoCoins: 30 }
    }));
    const start = () => JSON.parse(execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", `
        const s = await import(${JSON.stringify(new URL("./store.js", import.meta.url).href)});
        console.log(JSON.stringify({ cards: s.cardTable.all(), profile: s.getProfile("u1"), bingo: s.coinSettings().bingoCoins, suggestions: s.suggestionTable.all().length }));
    `], { env: { ...process.env, DATA_DIR: dir } }));
    try {
        const first = start();
        assert.deepEqual(first.cards, [{ id: "c1", text: "Ute", description: "", pack: "core", dealt: 3, spotted: 1, counted: 2 }]);
        assert.deepEqual(first.profile, { wins: 2, coins: 40, skins: { c1: { owned: ["gold"], equipped: "gold" } } });
        assert.equal(first.bingo, 30);
        assert.equal(first.suggestions, 1);
        assert.equal(existsSync(join(dir, "store.json")), false);
        assert.equal(existsSync(join(dir, "store.imported.json")), true);
        assert.deepEqual(start(), first, "a second start uses the database as it is");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
