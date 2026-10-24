// Admins add, edit and delete cards and sort them into packs; hosts pick which packs their room deals from
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { cardsIn, save, store } from "./store.js";
import { adminOnly, cardProblem, json, signedIn, tidy, tidyLines } from "./suggestions.js";

export const cards = Router();

const packList = () => store.packs.map(pack => ({ ...pack, count: cardsIn([pack.id]).length }));
// A field left out of an edit keeps its current value
const field = (body, name, current, read = tidy) => body?.[name] === undefined ? current : read(body[name]);

function packProblem({ name, description }, ignoreId) {
    if (name.length < 2 || name.length > 30) return "Give the pack a name of 2 to 30 characters.";
    if (store.packs.some(pack => pack.id !== ignoreId && pack.name.toLowerCase() === name.toLowerCase())) return "There's already a pack called that.";
    if (description.length > 140) return "Keep the description to 140 characters.";
    return null;
}

// What players need: the packs to pick from and the words on the cards (no stats)
// rate: how often it's spotted when dealt, as a percentage, once it's been dealt 10 times
cards.get("/api/cards", signedIn, (req, res) => {
    res.json({
        packs: packList(),
        cards: store.cards.map(({ id, text, description, pack, dealt, spotted }) => ({
            id, text, description, pack, rate: dealt >= 10 ? Math.round(spotted / dealt * 100) : null
        }))
    });
});

cards.get("/api/admin/cards", adminOnly, (req, res) => res.json({ packs: packList(), cards: store.cards }));

cards.post("/api/admin/cards", adminOnly, json, (req, res) => {
    const card = { text: tidy(req.body?.text), description: tidyLines(req.body?.description), pack: String(req.body?.pack ?? "") };
    const problem = cardProblem(card);
    if (problem) return res.status(400).json({ error: problem });
    const row = { id: randomUUID(), ...card, by: null, at: Date.now(), dealt: 0, spotted: 0 };
    store.cards.push(row);
    save();
    res.json(row);
});

cards.patch("/api/admin/cards/:id", adminOnly, json, (req, res) => {
    const row = store.cards.find(card => card.id === req.params.id);
    if (!row) return res.status(404).json({ error: "That card has been deleted." });
    const card = {
        text: field(req.body, "text", row.text),
        description: field(req.body, "description", row.description, tidyLines),
        pack: field(req.body, "pack", row.pack, String)
    };
    const problem = cardProblem(card, row.id);
    if (problem) return res.status(400).json({ error: problem });
    Object.assign(row, card);
    save();
    res.json(row);
});

cards.delete("/api/admin/cards/:id", adminOnly, (req, res) => {
    const index = store.cards.findIndex(card => card.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: "Already deleted." });
    if (store.cards.length <= 24) return res.status(400).json({ error: "Keep at least 24 cards so a whole card can be dealt." });
    store.cards.splice(index, 1);
    const suggestion = store.suggestions.find(s => s.id === req.params.id);
    if (suggestion) suggestion.status = "removed";
    save();
    res.json({ ok: true });
});

cards.post("/api/admin/packs", adminOnly, json, (req, res) => {
    const pack = { name: tidy(req.body?.name), description: tidy(req.body?.description), on: req.body?.on === true };
    const problem = packProblem(pack);
    if (problem) return res.status(400).json({ error: problem });
    const row = { id: randomUUID(), ...pack };
    store.packs.push(row);
    save();
    res.json(row);
});

cards.patch("/api/admin/packs/:id", adminOnly, json, (req, res) => {
    const row = store.packs.find(pack => pack.id === req.params.id);
    if (!row) return res.status(404).json({ error: "That pack has been deleted." });
    const pack = {
        name: field(req.body, "name", row.name),
        description: field(req.body, "description", row.description),
        on: field(req.body, "on", row.on, on => on === true)
    };
    const problem = packProblem(pack, row.id);
    if (problem) return res.status(400).json({ error: problem });
    Object.assign(row, pack);
    save();
    res.json(row);
});

cards.delete("/api/admin/packs/:id", adminOnly, (req, res) => {
    const index = store.packs.findIndex(pack => pack.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: "Already deleted." });
    if (cardsIn([req.params.id]).length) return res.status(400).json({ error: "Move or delete its cards first." });
    if (store.packs.length === 1) return res.status(400).json({ error: "Keep at least one pack." });
    store.packs.splice(index, 1);
    save();
    res.json({ ok: true });
});
