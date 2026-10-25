import assert from "node:assert/strict";
import test from "node:test";
import { deleteMode, modeProblem, modesProblem, packsProblem } from "./cards.js";
import { deckFor, modeFrom, packsFrom } from "./rooms.js";
import { cardTable, cardsIn, modeTable, packModes, packsOf, packTable } from "./store.js";

const card = (n, packs) => ({ id: `m${n}`, text: `Mode card ${n}`, description: "", pack: packs[0], packs, dealt: 0, spotted: 0, counted: 0 });
const put = cards => cards.forEach(c => cardTable.put(c.id, c));
const remove = cards => cards.forEach(c => cardTable.remove(c.id));

test("Normal and Police Karma are there to start, and older cards and packs fill in their packs and modes", () => {
    assert.deepEqual(modeTable.all().map(mode => mode.id), ["normal", "police-karma"]);
    assert.deepEqual(packsOf({ pack: "core" }), ["core"]);
    assert.deepEqual(packsOf({ pack: "core", packs: ["core", "pk"] }), ["core", "pk"]);
    assert.deepEqual(packModes({}), ["normal"]);
    assert.equal(modeFrom("police-karma"), "police-karma");
    assert.equal(modeFrom("nope"), null);
    assert.equal(modeFrom({}), null);
});

test("a mode deals from its packs' cards, each once, falling back to the whole mode, then every card", () => {
    packTable.put("p1", { id: "p1", name: "P1", on: false, modes: ["police-karma"] });
    packTable.put("p2", { id: "p2", name: "P2", on: false, modes: ["normal", "police-karma"] });
    const cards = [
        ...Array.from({ length: 20 }, (_, i) => card(i, ["p1"])),
        ...Array.from({ length: 10 }, (_, i) => card(20 + i, ["p2"])),
        ...Array.from({ length: 5 }, (_, i) => card(30 + i, ["p2", "p1"])) // In both packs
    ];
    put(cards);
    try {
        assert.equal(cardsIn(["p1", "p2"], "police-karma").length, 35, "the 5 in both count once");
        assert.equal(cardsIn(["p1", "p2"]).length, 15, "P1 isn't in Normal");
        assert.deepEqual(packsFrom(["p1", "p2"], "police-karma"), ["p1", "p2"]);
        assert.deepEqual(packsFrom(["p1"], "police-karma"), ["p1"], "20 of its own and 5 shared");
        assert.equal(packsFrom(["p2"], "police-karma"), null, "only 15");
        assert.equal(packsFrom(["p1", "p2"]), null, "P1 isn't in Normal, leaving 15");
        assert.equal(deckFor({ mode: "police-karma", packs: ["p1", "p2"] }).length, 35);
        assert.equal(deckFor({ mode: "police-karma", packs: ["p2"] }).length, 35, "too few in P2: the whole mode instead");
        assert.equal(deckFor({ mode: "deleted", packs: ["p1"] }).length, cardTable.all().length, "then every card");
    } finally {
        remove(cards);
        packTable.remove("p1");
        packTable.remove("p2");
    }
});

test("modesProblem, packsProblem and modeProblem turn away junk", () => {
    assert.equal(modesProblem(["normal", "police-karma"]), null);
    assert.equal(packsProblem(["core"]), null);
    for (const junk of [[], ["nope"], ["normal", "normal"], "normal", null, [1]]) assert.match(modesProblem(junk), /at least one/, JSON.stringify(junk));
    for (const junk of [[], ["nope"], ["core", "core"], "core", undefined]) assert.match(packsProblem(junk), /at least one pack/, JSON.stringify(junk));
    assert.equal(modeProblem({ name: "Truck Karma", description: "" }), null);
    assert.match(modeProblem({ name: "police karma", description: "" }), /already a mode/);
    assert.match(modeProblem({ name: "x", description: "" }), /2 to 30/);
    assert.equal(modeProblem({ name: "Police Karma", description: "" }, "police-karma"), null, "its own name is fine");
});

test("deleting a mode takes it off its packs, sends packs left with none back to Normal, and Normal stays", () => {
    modeTable.put("truck", { id: "truck", name: "Truck", description: "" });
    packTable.put("t1", { id: "t1", name: "T1", on: false, modes: ["truck"] });
    packTable.put("t2", { id: "t2", name: "T2", on: false, modes: ["truck", "police-karma"] });
    try {
        assert.match(deleteMode("normal"), /Normal stays/);
        assert.equal(deleteMode("truck"), null);
        assert.equal(modeTable.get("truck"), undefined);
        assert.deepEqual(packTable.get("t1").modes, ["normal"]);
        assert.deepEqual(packTable.get("t2").modes, ["police-karma"]);
        assert.match(deleteMode("truck"), /Already deleted/);
    } finally {
        packTable.remove("t1");
        packTable.remove("t2");
    }
});
