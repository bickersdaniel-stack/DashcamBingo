import assert from "node:assert/strict";
import test from "node:test";
import { deleteMode, modeProblem, modesProblem } from "./cards.js";
import { deckFor, modeFrom, packsFrom } from "./rooms.js";
import { cardTable, cardsIn, modesOf, modeTable, packTable } from "./store.js";

const card = (n, pack, modes) => ({ id: `m${n}`, text: `Mode card ${n}`, description: "", pack, modes, dealt: 0, spotted: 0, counted: 0 });
const put = cards => cards.forEach(c => cardTable.put(c.id, c));
const remove = cards => cards.forEach(c => cardTable.remove(c.id));

test("Normal and Police Karma are there to start, and cards from before modes count as Normal", () => {
    assert.deepEqual(modeTable.all().map(mode => mode.id), ["normal", "police-karma"]);
    assert.deepEqual(modesOf({}), ["normal"]);
    assert.deepEqual(modesOf({ modes: ["police-karma"] }), ["police-karma"]);
    assert.equal(modeFrom("police-karma"), "police-karma");
    assert.equal(modeFrom("nope"), null);
    assert.equal(modeFrom({}), null);
});

test("cardsIn, packsFrom and deckFor deal from the mode's cards in the packs, falling back to the whole mode, then every card", () => {
    packTable.put("p1", { id: "p1", name: "P1", on: false });
    packTable.put("p2", { id: "p2", name: "P2", on: false });
    const cards = [
        ...Array.from({ length: 20 }, (_, i) => card(i, "p1", ["police-karma"])),
        ...Array.from({ length: 10 }, (_, i) => card(20 + i, "p2", ["normal", "police-karma"]))
    ];
    put(cards);
    try {
        assert.equal(cardsIn(["p1", "p2"], "police-karma").length, 30);
        assert.equal(cardsIn(["p1", "p2"]).length, 10, "Normal by default; police-only cards stay out");
        assert.deepEqual(packsFrom(["p1", "p2"], "police-karma"), ["p1", "p2"]);
        assert.equal(packsFrom(["p1"], "police-karma"), null, "only 20 in that pack");
        assert.equal(packsFrom(["p1", "p2"]), null, "only 10 Normal cards there");
        assert.equal(deckFor({ mode: "police-karma", packs: ["p1", "p2"] }).length, 30);
        const wholeMode = deckFor({ mode: "police-karma", packs: ["p2"] }); // 10 in the pack: the whole mode instead
        assert.ok(wholeMode.length >= 30 && wholeMode.every(c => modesOf(c).includes("police-karma")));
        assert.equal(deckFor({ mode: "deleted", packs: ["p1"] }).length, cardTable.all().length, "then every card");
    } finally {
        remove(cards);
        packTable.remove("p1");
        packTable.remove("p2");
    }
});

test("modesProblem and modeProblem turn away junk", () => {
    assert.equal(modesProblem(["normal"]), null);
    assert.equal(modesProblem(["normal", "police-karma"]), null);
    for (const junk of [[], ["nope"], ["normal", "normal"], "normal", null, [1]]) assert.match(modesProblem(junk), /at least one/, JSON.stringify(junk));
    assert.equal(modeProblem({ name: "Truck Karma", description: "" }), null);
    assert.match(modeProblem({ name: "police karma", description: "" }), /already a mode/);
    assert.match(modeProblem({ name: "x", description: "" }), /2 to 30/);
    assert.equal(modeProblem({ name: "Police Karma", description: "" }, "police-karma"), null, "its own name is fine");
});

test("deleting a mode takes it off its cards, sends cards left with none back to Normal, and Normal stays", () => {
    modeTable.put("truck", { id: "truck", name: "Truck", description: "" });
    const cards = [card(1, "core", ["truck"]), card(2, "core", ["truck", "police-karma"])];
    put(cards);
    try {
        assert.match(deleteMode("normal"), /Normal stays/);
        assert.equal(deleteMode("truck"), null);
        assert.equal(modeTable.get("truck"), undefined);
        assert.deepEqual(cardTable.get("m1").modes, ["normal"]);
        assert.deepEqual(cardTable.get("m2").modes, ["police-karma"]);
        assert.match(deleteMode("truck"), /Already deleted/);
    } finally {
        remove(cards);
    }
});
