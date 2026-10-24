// Admins add, edit and delete cards and sort them into packs; hosts pick which packs their room deals from
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { cardsIn, cardTable, packTable, suggestionTable, transaction } from "./store.js";
import { adminOnly, cardProblem, json, signedIn, tidy, tidyLines } from "./suggestions.js";

export const cards = Router();

const packList = () => packTable.all().map(pack => ({ ...pack, count: cardsIn([pack.id]).length }));
// A field left out of an edit keeps its current value
const field = (body, name, current, read = tidy) => body?.[name] === undefined ? current : read(body[name]);

function packProblem({ name, description }, ignoreId) {
    if (name.length < 2 || name.length > 30) return "Give the pack a name of 2 to 30 characters.";
    if (packTable.all().some(pack => pack.id !== ignoreId && pack.name.toLowerCase() === name.toLowerCase())) return "There's already a pack called that.";
    if (description.length > 140) return "Keep the description to 140 characters.";
    return null;
}

// What players need: the packs to pick from and the words on the cards (no stats)
// rate: how often it's spotted when dealt, as a percentage, once it's been dealt 10 times
cards.get("/api/cards", signedIn, (req, res) => {
    res.json({
        packs: packList(),
        cards: cardTable.all().map(({ id, text, description, pack, dealt, spotted }) => ({
            id, text, description, pack, rate: dealt >= 10 ? Math.round(spotted / dealt * 100) : null
        }))
    });
});

cards.get("/api/admin/cards", adminOnly, (req, res) => res.json({ packs: packList(), cards: cardTable.all() }));

cards.post("/api/admin/cards", adminOnly, json, (req, res) => {
    const card = { text: tidy(req.body?.text), description: tidyLines(req.body?.description), pack: String(req.body?.pack ?? "") };
    const problem = cardProblem(card);
    if (problem) return res.status(400).json({ error: problem });
    const row = { id: randomUUID(), ...card, by: null, at: Date.now(), dealt: 0, spotted: 0, counted: 0 };
    cardTable.put(row.id, row);
    res.json(row);
});

// counted = every sighting, spotted = marked on a deal, dealt = times it was on a card
export function cardStatsProblem(body) {
    for (const name of ["counted", "spotted", "dealt"]) {
        if (body?.[name] === undefined) continue;
        if (!(Number.isInteger(body[name]) && body[name] >= 0 && body[name] <= 100_000)) {
            return "Counts must be whole numbers from 0 to 100000.";
        }
    }
    return null;
}

// In one transaction with the read, so a count landing mid-edit isn't lost
cards.patch("/api/admin/cards/:id", adminOnly, json, (req, res) => {
    const result = cardTable.update(req.params.id, row => {
        const card = {
            text: field(req.body, "text", row.text),
            description: field(req.body, "description", row.description, tidyLines),
            pack: field(req.body, "pack", row.pack, String)
        };
        const problem = cardProblem(card, row.id) ?? cardStatsProblem(req.body);
        if (problem) return { error: problem };
        const stats = {};
        for (const name of ["counted", "spotted", "dealt"]) if (req.body?.[name] !== undefined) stats[name] = req.body[name];
        return { row: Object.assign(row, card, stats) };
    });
    if (!result) return res.status(404).json({ error: "That card has been deleted." });
    if (result.error) return res.status(400).json(result);
    res.json(result.row);
});

cards.delete("/api/admin/cards/:id", adminOnly, (req, res) => {
    const error = transaction(() => {
        if (!cardTable.get(req.params.id)) return [404, "Already deleted."];
        if (cardTable.all().length <= 24) return [400, "Keep at least 24 cards so a whole card can be dealt."];
        cardTable.remove(req.params.id);
        suggestionTable.update(req.params.id, suggestion => { suggestion.status = "removed"; });
    });
    if (error) return res.status(error[0]).json({ error: error[1] });
    res.json({ ok: true });
});

cards.post("/api/admin/packs", adminOnly, json, (req, res) => {
    const pack = { name: tidy(req.body?.name), description: tidy(req.body?.description), on: req.body?.on === true };
    const problem = packProblem(pack);
    if (problem) return res.status(400).json({ error: problem });
    const row = { id: randomUUID(), ...pack };
    packTable.put(row.id, row);
    res.json(row);
});

cards.patch("/api/admin/packs/:id", adminOnly, json, (req, res) => {
    const result = packTable.update(req.params.id, row => {
        const pack = {
            name: field(req.body, "name", row.name),
            description: field(req.body, "description", row.description),
            on: field(req.body, "on", row.on, on => on === true)
        };
        const problem = packProblem(pack, row.id);
        if (problem) return { error: problem };
        return { row: Object.assign(row, pack) };
    });
    if (!result) return res.status(404).json({ error: "That pack has been deleted." });
    if (result.error) return res.status(400).json(result);
    res.json(result.row);
});

cards.delete("/api/admin/packs/:id", adminOnly, (req, res) => {
    const error = transaction(() => {
        if (!packTable.get(req.params.id)) return [404, "Already deleted."];
        if (cardsIn([req.params.id]).length) return [400, "Move or delete its cards first."];
        if (packTable.all().length === 1) return [400, "Keep at least one pack."];
        packTable.remove(req.params.id);
    });
    if (error) return res.status(error[0]).json({ error: error[1] });
    res.json({ ok: true });
});
