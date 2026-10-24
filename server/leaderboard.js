// Who has won the most, and which cards turn up the most. For signed-in players only, since it shows names
import { Router } from "express";
import { store } from "./store.js";
import { signedIn } from "./suggestions.js";

export const leaderboard = Router();
const minDeals = 10;  // A card's spotted rate means little before it's been dealt this many times
const rareCount = 5;  // The least spotted cards with enough games get flagged as rare sightings

// Everyone with a win, most first; people on the same number share a place (1, 2, 2, 4)
export function rankPlayers(profiles) {
    const rows = Object.entries(profiles)
        .filter(([, profile]) => (profile.wins ?? 0) > 0 && !profile.blocked)
        .map(([id, profile]) => ({ id, name: profile.name ?? "Someone", avatar: profile.avatar ?? "", wins: profile.wins }))
        .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
    rows.forEach((row, i) => row.rank = i > 0 && row.wins === rows[i - 1].wins ? rows[i - 1].rank : i + 1);
    return rows;
}

// Cards with enough games, most often spotted first, then the rest by how many times they've been counted
export function rankCards(cards, packs) {
    const packName = id => packs.find(pack => pack.id === id)?.name ?? "";
    const row = card => ({ id: card.id, text: card.text, pack: packName(card.pack), counted: card.counted ?? 0, dealt: card.dealt ?? 0 });
    const ranked = cards.filter(card => card.dealt >= minDeals)
        .map(card => ({ ...row(card), rate: Math.round(card.spotted / card.dealt * 100) }))
        .sort((a, b) => b.rate - a.rate || b.counted - a.counted);
    ranked.slice(-rareCount).forEach(card => card.rare = ranked.length > rareCount);
    const unranked = cards.filter(card => !(card.dealt >= minDeals)).map(card => ({ ...row(card), rate: null }))
        .sort((a, b) => b.counted - a.counted || a.text.localeCompare(b.text));
    return [...ranked, ...unranked];
}

leaderboard.get("/api/leaderboard", signedIn, (req, res) => {
    const players = rankPlayers(store.profiles);
    res.json({
        players: players.slice(0, 50),
        total: players.length,
        me: players.find(player => player.id === req.session.user.id) ?? null,
        cards: rankCards(store.cards, store.packs)
    });
});
