// Who has won the most, and which cards turn up the most. For signed-in players only, since it shows names
import { Router } from "express";
import { achievements } from "./achievements.js";
import { skinInfo } from "./shop.js";
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
    const row = card => ({
        id: card.id, text: card.text, description: card.description ?? "", pack: packName(card.pack), packId: card.pack,
        counted: card.counted ?? 0, spotted: card.spotted ?? 0, dealt: card.dealt ?? 0
    });
    const ranked = cards.filter(card => card.dealt >= minDeals)
        .map(card => ({ ...row(card), rate: Math.round(card.spotted / card.dealt * 100) }))
        .sort((a, b) => b.rate - a.rate || b.counted - a.counted);
    ranked.slice(-rareCount).forEach(card => card.rare = ranked.length > rareCount);
    const unranked = cards.filter(card => !(card.dealt >= minDeals)).map(card => ({ ...row(card), rate: null }))
        .sort((a, b) => b.counted - a.counted || a.text.localeCompare(b.text));
    return [...ranked, ...unranked];
}

// One player as everyone else sees them: wins and place, skins collected, the achievements they've earned (not the
// ones still to get, so hidden ones stay hidden) and the card they show off. null for nobody or someone blocked
export function profileOf(id, profiles, cards, packs) {
    const profile = Object.hasOwn(profiles, id) ? profiles[id] : null;
    if (!profile || profile.blocked) return null;
    const card = cards.find(card => card.id === profile.showcase); // Gone if an admin deleted it
    return {
        id, name: profile.name ?? "Someone", avatar: profile.avatar ?? "", wins: profile.wins ?? 0,
        rank: rankPlayers(profiles).find(row => row.id === id)?.rank ?? null,
        skins: Object.values(profile.skins ?? {}).reduce((sum, entry) => sum + entry.owned.length, 0),
        achievements: achievements.filter(a => profile.achievements?.[a.id])
            .map(a => ({ name: a.name, description: a.description, earnedAt: profile.achievements[a.id] }))
            .sort((a, b) => b.earnedAt - a.earnedAt),
        achievementTotal: achievements.length,
        showcase: card ? {
            text: card.text, description: card.description ?? "", pack: card.pack,
            packName: packs.find(pack => pack.id === card.pack)?.name ?? "", skin: skinInfo(profile.skins?.[card.id]?.equipped)
        } : null
    };
}

leaderboard.get("/api/players/:id", signedIn, (req, res) => {
    const profile = profileOf(req.params.id, store.profiles, store.cards, store.packs);
    if (!profile) return res.status(404).json({ error: "There's no profile to show yet." });
    res.json(profile);
});

leaderboard.get("/api/leaderboard", signedIn, (req, res) => {
    const players = rankPlayers(store.profiles);
    res.json({
        players: players.slice(0, 50),
        total: players.length,
        me: players.find(player => player.id === req.session.user.id) ?? null,
        cards: rankCards(store.cards, store.packs)
    });
});
