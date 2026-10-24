import assert from "node:assert/strict";
import test from "node:test";
import { packsFrom, pickCards } from "./rooms.js";
import { cardStatsProblem } from "./cards.js";
import { migrate, store } from "./store.js";
import { tidyLines } from "./suggestions.js";

const card = (n, pack = "core", dealt = 0, spotted = 0) => ({ id: `c${n}`, text: `Card ${n}`, description: "", pack, dealt, spotted });

test("tidyLines keeps line breaks in descriptions but tidies each line", () => {
    assert.equal(tidyLines("  Must be alive  \r\n- not   roadkill\n\n\n\nOn the road\u0007 "), "Must be alive\n- not roadkill\n\nOn the road");
    assert.equal(tidyLines("\n\n  one line \n"), "one line");
    assert.equal(tidyLines(undefined), "");
});

test("migrate turns the phrase list and approved suggestions into Core cards", () => {
    const by = { id: "u1", name: "Sam" };
    const data = migrate({ approved: [{ id: "s1", text: "Love tap", by, at: 5 }], suggestions: [] }, ["Speed camera", "Ute driver"]);
    assert.deepEqual(data.packs, [{ id: "core", name: "Core", description: "", on: true }]);
    assert.deepEqual(data.cards.map(c => c.text), ["Speed camera", "Ute driver", "Love tap"]);
    assert.ok(data.cards.every(c => c.pack === "core" && c.dealt === 0 && c.spotted === 0 && c.counted === 0 && c.description === ""));
    assert.deepEqual(data.cards[2], { id: "s1", text: "Love tap", by, at: 5, description: "", pack: "core", dealt: 0, spotted: 0, counted: 0 });
    assert.equal("approved" in data, false);
    assert.equal(migrate(data, ["Other"]).cards.length, 3); // Already migrated: left alone
});

test("cardStatsProblem accepts whole counts and rejects junk", () => {
    assert.equal(cardStatsProblem({}), null);
    assert.equal(cardStatsProblem({ counted: 5, spotted: 2, dealt: 10 }), null);
    assert.match(cardStatsProblem({ counted: -1 }), /whole number/);
    assert.match(cardStatsProblem({ spotted: 1.5 }), /whole number/);
    assert.match(cardStatsProblem({ dealt: 100001 }), /whole number/);
});

test("pickCards deals 24 different cards, 8 from each third by how often they're spotted", () => {
    const common = Array.from({ length: 10 }, (_, i) => card(i, "core", 20, 18));
    const middle = Array.from({ length: 10 }, (_, i) => card(10 + i, "core", 20, 10));
    const rare = Array.from({ length: 10 }, (_, i) => card(20 + i, "core", 20, 1));
    const picked = pickCards([...rare, ...common, ...middle]);
    assert.equal(picked.length, 24);
    assert.equal(new Set(picked.map(c => c.id)).size, 24);
    for (const tier of [common, middle, rare]) assert.equal(picked.filter(c => tier.includes(c)).length, 8);

    const fresh = Array.from({ length: 30 }, (_, i) => card(i)); // No games yet
    assert.equal(new Set(pickCards(fresh).map(c => c.id)).size, 24);
});

test("packsFrom keeps real packs with enough cards for a whole card", () => {
    const saved = { packs: store.packs, cards: store.cards };
    store.packs = [{ id: "a", on: true }, { id: "b", on: false }];
    store.cards = [...Array.from({ length: 20 }, (_, i) => card(i, "a")), ...Array.from({ length: 10 }, (_, i) => card(20 + i, "b"))];
    try {
        assert.deepEqual(packsFrom(["a", "b", "a", "nope"]), ["a", "b"]);
        assert.equal(packsFrom(["a"]), null); // Only 20 cards
        assert.equal(packsFrom("a"), null);
    } finally {
        Object.assign(store, saved); // In memory only; nothing here saves
    }
});
