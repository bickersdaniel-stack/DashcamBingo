// Players suggest new squares; admins approve them into a pack (tidying the wording first if they like) or reject them
import { randomUUID } from "node:crypto";
import express, { Router } from "express";
import { isAdmin } from "./auth.js";
import { cardTable, defaultPacks, isBlocked, packTable, suggestionTable } from "./store.js";

export const suggestions = Router();
export const json = express.json({ limit: "2kb" }); // JSON only, so other sites can't post here with a plain form
const lastSuggestion = new Map(); // User id -> time, so nobody can fire off dozens

export const signedIn = (req, res, next) => req.session.user ? next() : res.status(401).json({ error: "Sign in first." });
export const adminOnly = (req, res, next) => isAdmin(req.session.user) ? next() : res.status(403).json({ error: "Admins only." });

// One space between words, no control characters
export const tidy = text => String(text ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
// The same for each line of a card's description, keeping the line breaks (and at most one blank line in a row)
export const tidyLines = text => String(text ?? "").split(/\r\n?|\n/).map(tidy).join("\n").replace(/\n{3,}/g, "\n\n").trim();
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

// ignoreId skips the card or suggestion being edited, so keeping its own wording isn't a clash
function problemWith(text, ignoreId) {
    if (text.length < 3) return "Make it at least 3 characters.";
    if (text.length > 60) return "Keep it to 60 characters so it fits on a square.";
    if (cardTable.all().some(card => card.id !== ignoreId && same(card.text, text))) return "That one's already on the cards.";
    if (suggestionTable.all().some(s => s.status === "pending" && s.id !== ignoreId && same(s.text, text))) return "Someone's already suggested that.";
    return null;
}

const descriptionProblem = description => description.length > 300 ? "Keep the description to 300 characters." : null;

export function cardProblem({ text, description, pack }, ignoreId) {
    return problemWith(text, ignoreId) ?? descriptionProblem(description)
        ?? (packTable.get(pack) ? null : "Pick a pack.");
}

suggestions.get("/api/suggestions", signedIn, (req, res) => {
    res.json(suggestionTable.all().filter(s => s.by.id === req.session.user.id).slice(-20).reverse());
});

suggestions.post("/api/suggestions", signedIn, json, (req, res) => {
    const user = req.session.user;
    if (isBlocked(user.id)) return res.status(403).json({ error: "You can't suggest squares right now." });
    const text = tidy(req.body?.text);
    const description = tidyLines(req.body?.description);
    const problem = problemWith(text) ?? descriptionProblem(description);
    if (problem) return res.status(400).json({ error: problem });
    if (suggestionTable.all().filter(s => s.by.id === user.id && s.status === "pending").length >= 5) {
        return res.status(429).json({ error: "You have 5 waiting already. Wait for those to be looked at." });
    }
    if (Date.now() - (lastSuggestion.get(user.id) ?? 0) < 10_000) return res.status(429).json({ error: "Give it a few seconds between suggestions." });
    lastSuggestion.set(user.id, Date.now());
    const suggestion = { id: randomUUID(), text, description, by: { id: user.id, name: user.name }, at: Date.now(), status: "pending" };
    suggestionTable.put(suggestion.id, suggestion);
    res.json(suggestion);
});

suggestions.get("/api/admin/suggestions", adminOnly, (req, res) => {
    res.json({ pending: suggestionTable.all().filter(s => s.status === "pending") });
});

// Approve into a pack (optionally with tidied-up wording and description) or reject a suggestion
// The suggestion and its new card are written in one transaction
suggestions.post("/api/admin/suggestions/:id", adminOnly, json, (req, res) => {
    const gone = { status: 404, error: "That suggestion has already been dealt with." };
    const result = suggestionTable.update(req.params.id, suggestion => {
        if (suggestion.status !== "pending") return gone;
        if (req.body?.action === "reject") {
            suggestion.status = "rejected";
        } else if (req.body?.action === "approve") {
            const card = {
                text: req.body.text === undefined ? suggestion.text : tidy(req.body.text),
                description: req.body.description === undefined ? suggestion.description ?? "" : tidyLines(req.body.description),
                pack: String(req.body.pack ?? defaultPacks()[0] ?? packTable.all()[0].id)
            };
            const problem = cardProblem(card, suggestion.id);
            if (problem) return { status: 400, error: problem };
            Object.assign(suggestion, { status: "approved", text: card.text, description: card.description });
            cardTable.put(suggestion.id, { id: suggestion.id, ...card, modes: ["normal"], by: suggestion.by, at: Date.now(), dealt: 0, spotted: 0, counted: 0 });
        } else {
            return { status: 400, error: "Approve or reject." };
        }
        suggestion.decidedAt = Date.now();
        return { suggestion };
    }) ?? gone;
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result.suggestion);
});
