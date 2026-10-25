// Admins add, edit and delete cards, sort them into packs and tick the game modes each is dealt in; hosts pick a mode,
// then which of its packs their room deals from
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { cardTable, modesOf, modeTable, packTable, suggestionTable, transaction } from "./store.js";
import { adminOnly, cardProblem, json, signedIn, tidy, tidyLines } from "./suggestions.js";

export const cards = Router();

// Each pack with how many cards it holds, in all and in each game mode
function packList() {
    const all = cardTable.all();
    const modes = modeTable.all();
    return packTable.all().map(pack => {
        const inPack = all.filter(card => card.pack === pack.id);
        const counts = Object.fromEntries(modes.map(mode => [mode.id, inPack.filter(card => modesOf(card).includes(mode.id)).length]));
        return { ...pack, count: inPack.length, counts };
    });
}

// Each game mode with how many cards are in it
function modeList() {
    const all = cardTable.all();
    return modeTable.all().map(mode => ({ ...mode, count: all.filter(card => modesOf(card).includes(mode.id)).length }));
}

// A field left out of an edit keeps its current value
const field = (body, name, current, read = tidy) => body?.[name] === undefined ? current : read(body[name]);

// A pack's or mode's name and description (what: "pack" or "mode")
function nameProblem(rows, what, { name, description }, ignoreId) {
    if (name.length < 2 || name.length > 30) return `Give the ${what} a name of 2 to 30 characters.`;
    if (rows.some(row => row.id !== ignoreId && row.name.toLowerCase() === name.toLowerCase())) return `There's already a ${what} called that.`;
    if (description.length > 140) return "Keep the description to 140 characters.";
    return null;
}
const packProblem = (pack, ignoreId) => nameProblem(packTable.all(), "pack", pack, ignoreId);
export const modeProblem = (mode, ignoreId) => nameProblem(modeTable.all(), "mode", mode, ignoreId);

// The game modes a card is ticked into: at least one, each a real mode, none twice
export function modesProblem(modes) {
    const ok = Array.isArray(modes) && modes.length > 0 && new Set(modes).size === modes.length
        && modes.every(id => typeof id === "string" && modeTable.get(id));
    return ok ? null : "Tick at least one game mode.";
}

// What players need: the packs to pick from and the words on the cards (no stats)
// rate: how often it's spotted when dealt, as a percentage, once it's been dealt 10 times
cards.get("/api/cards", signedIn, (req, res) => {
    res.json({
        packs: packList(),
        modes: modeList(),
        cards: cardTable.all().map(card => ({
            id: card.id, text: card.text, description: card.description, pack: card.pack, modes: modesOf(card),
            rate: card.dealt >= 10 ? Math.round(card.spotted / card.dealt * 100) : null
        }))
    });
});

cards.get("/api/admin/cards", adminOnly, (req, res) => {
    res.json({ packs: packList(), modes: modeList(), cards: cardTable.all().map(card => ({ ...card, modes: modesOf(card) })) });
});

cards.post("/api/admin/cards", adminOnly, json, (req, res) => {
    const card = { text: tidy(req.body?.text), description: tidyLines(req.body?.description), pack: String(req.body?.pack ?? "") };
    const modes = req.body?.modes ?? ["normal"];
    const problem = cardProblem(card) ?? modesProblem(modes);
    if (problem) return res.status(400).json({ error: problem });
    const row = { id: randomUUID(), ...card, modes, by: null, at: Date.now(), dealt: 0, spotted: 0, counted: 0 };
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
        const problem = cardProblem(card, row.id) ?? cardStatsProblem(req.body) ?? (req.body?.modes === undefined ? null : modesProblem(req.body.modes));
        if (problem) return { error: problem };
        const stats = {};
        for (const name of ["counted", "spotted", "dealt"]) if (req.body?.[name] !== undefined) stats[name] = req.body[name];
        if (req.body?.modes !== undefined) row.modes = req.body.modes;
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
        if (cardTable.all().some(card => card.pack === req.params.id)) return [400, "Move or delete its cards first."];
        if (packTable.all().length === 1) return [400, "Keep at least one pack."];
        packTable.remove(req.params.id);
    });
    if (error) return res.status(error[0]).json({ error: error[1] });
    res.json({ ok: true });
});

cards.post("/api/admin/modes", adminOnly, json, (req, res) => {
    const mode = { name: tidy(req.body?.name), description: tidy(req.body?.description) };
    const problem = modeProblem(mode);
    if (problem) return res.status(400).json({ error: problem });
    const row = { id: randomUUID(), ...mode };
    modeTable.put(row.id, row);
    res.json(row);
});

cards.patch("/api/admin/modes/:id", adminOnly, json, (req, res) => {
    const result = modeTable.update(req.params.id, row => {
        const mode = { name: field(req.body, "name", row.name), description: field(req.body, "description", row.description) };
        const problem = modeProblem(mode, row.id);
        if (problem) return { error: problem };
        return { row: Object.assign(row, mode) };
    });
    if (!result) return res.status(404).json({ error: "That mode has been deleted." });
    if (result.error) return res.status(400).json(result);
    res.json(result.row);
});

// Takes the mode off every card, then deletes it; a card left in no mode goes back to Normal, so it can still be dealt.
// Rooms playing it deal from every card in their packs until the host picks another
export function deleteMode(id) {
    if (id === "normal") return "Normal stays. Rename it if you like.";
    return transaction(() => {
        if (!modeTable.get(id)) return "Already deleted.";
        for (const card of cardTable.all()) {
            if (!modesOf(card).includes(id)) continue;
            cardTable.update(card.id, row => {
                const left = modesOf(row).filter(mode => mode !== id);
                row.modes = left.length ? left : ["normal"];
            });
        }
        modeTable.remove(id);
        return null;
    });
}

cards.delete("/api/admin/modes/:id", adminOnly, (req, res) => {
    const problem = deleteMode(req.params.id);
    if (problem) return res.status(problem === "Already deleted." ? 404 : 400).json({ error: problem });
    res.json({ ok: true });
});
