// The shop: spend coins on rolls for card skins (a style on one card), collect them, and wear them on your squares.
// Coins only come from playing; nothing here costs real money
import { randomInt } from "node:crypto";
import { Router } from "express";
import { recordProgress } from "./achievements.js";
import { save, store, touchProfile } from "./store.js";
import { json, signedIn } from "./suggestions.js";

export const rollCost = 100;
export const duplicateRefund = 25;
export const pityAfter = 10; // After this many rolls without an epic or better, the next one is

export const rarities = [
    { id: "common", name: "Common", weight: 60 },
    { id: "rare", name: "Rare", weight: 28 },
    { id: "epic", name: "Epic", weight: 10 },
    { id: "legendary", name: "Legendary", weight: 2 }
];
// Each is drawn in styles.css (.skin-<id>), so there's no artwork to make
export const styles = [
    { id: "matte", name: "Matte", rarity: "common" },
    { id: "pastel", name: "Pastel", rarity: "common" },
    { id: "road-sign", name: "Road sign", rarity: "common" },
    { id: "neon", name: "Neon", rarity: "rare" },
    { id: "carbon", name: "Carbon fibre", rarity: "rare" },
    { id: "vhs", name: "Retro VHS", rarity: "rare" },
    { id: "holo", name: "Holo shimmer", rarity: "epic" },
    { id: "chrome", name: "Chrome", rarity: "epic" },
    { id: "sunset", name: "Outback sunset", rarity: "epic" },
    { id: "gold", name: "Gold foil", rarity: "legendary" },
    { id: "southern-cross", name: "Southern Cross", rarity: "legendary" }
];
const isTopShelf = rarity => rarity === "epic" || rarity === "legendary";

// A skin as the room and shop show it, or null
export const skinInfo = styleId => {
    const style = styles.find(s => s.id === styleId);
    return style ? { id: style.id, name: style.name, rarity: style.rarity } : null;
};

// One roll: a random card, then a rarity by weight (epic or better when the pity counter is full), then a style of
// that rarity. random(n) gives a whole number from 0 to n - 1
export function roll(cards, profile, random = randomInt) {
    const card = cards[random(cards.length)];
    const pool = (profile.pity ?? 0) >= pityAfter ? rarities.filter(r => isTopShelf(r.id)) : rarities;
    let ticket = random(pool.reduce((sum, r) => sum + r.weight, 0));
    const rarity = pool.find(r => (ticket -= r.weight) < 0);
    const options = styles.filter(s => s.rarity === rarity.id);
    return { card, rarity, style: options[random(options.length)] };
}

// Takes the coins, rolls, and adds the skin (a card's first skin goes straight on), or gives some coins back for a
// duplicate. Returns what happened, or { error }
export function buy(profile, cards, random = randomInt) {
    if ((profile.coins ?? 0) < rollCost) return { error: `A roll costs ${rollCost} coins.` };
    if (!cards.length) return { error: "There are no cards to roll for yet." };
    profile.coins -= rollCost;
    const { card, rarity, style } = roll(cards, profile, random);
    profile.pity = isTopShelf(rarity.id) ? 0 : (profile.pity ?? 0) + 1;
    const entry = (profile.skins ??= {})[card.id] ??= { owned: [], equipped: null };
    const duplicate = entry.owned.includes(style.id);
    if (duplicate) profile.coins += duplicateRefund;
    else {
        entry.owned.push(style.id);
        entry.equipped ??= style.id;
        (profile.newSkins ??= []).push(card.id); // Unseen until the Cards page is opened
    }
    const earned = recordProgress(profile, { legendaries: rarity.id === "legendary" ? 1 : 0, skins: duplicate ? 0 : 1 });
    return {
        card: { id: card.id, text: card.text, pack: card.pack, description: card.description },
        skin: skinInfo(style.id), duplicate, worn: !duplicate && entry.equipped === style.id,
        refund: duplicate ? duplicateRefund : 0, coins: profile.coins, pity: profile.pity, newSkins: profile.newSkins?.length ?? 0,
        achievements: earned.map(a => ({ name: a.name, description: a.description, coins: a.coins }))
    };
}

export const shop = Router();

shop.get("/api/shop", signedIn, (req, res) => {
    const profile = store.profiles[req.session.user.id] ?? {};
    const total = rarities.reduce((sum, r) => sum + r.weight, 0);
    res.json({
        coins: profile.coins ?? 0, cost: rollCost, refund: duplicateRefund, pity: profile.pity ?? 0, pityAfter, newSkins: profile.newSkins?.length ?? 0,
        rarities: rarities.map(r => ({ id: r.id, name: r.name, chance: Math.round(r.weight / total * 100) })), styles
    });
});

shop.post("/api/shop/roll", signedIn, (req, res) => {
    const profile = store.profiles[req.session.user.id] ??= { wins: 0 };
    const result = buy(profile, store.cards);
    if (result.error) return res.status(400).json(result);
    save();
    result.card.packName = store.packs.find(pack => pack.id === result.card.pack)?.name ?? "";
    res.json(result);
});

// Every card, with the skins you own for it, the one you're wearing, and whether it has a skin you haven't seen yet
shop.get("/api/me/collection", signedIn, (req, res) => {
    const profile = store.profiles[req.session.user.id] ?? {};
    const skins = profile.skins ?? {};
    const unseen = new Set(profile.newSkins ?? []);
    const packNames = new Map(store.packs.map(pack => [pack.id, pack.name]));
    res.json(store.cards.map(card => ({
        id: card.id, text: card.text, description: card.description, pack: card.pack, packName: packNames.get(card.pack) ?? "",
        owned: (skins[card.id]?.owned ?? []).map(skinInfo).filter(Boolean), equipped: skins[card.id]?.equipped ?? null,
        new: unseen.has(card.id), showcased: profile.showcase === card.id
    })));
});

// The Cards page has shown your new skins, so the "(+3)" goes
shop.post("/api/me/skins/seen", signedIn, (req, res) => {
    const profile = store.profiles[req.session.user.id];
    if (profile?.newSkins?.length) {
        profile.newSkins = [];
        save();
    }
    res.json({ ok: true });
});

// Wear one of your skins on a card, or none (style: null)
shop.post("/api/me/skins/equip", signedIn, json, (req, res) => {
    const entry = store.profiles[req.session.user.id]?.skins?.[String(req.body?.cardId)];
    const style = req.body?.style ?? null;
    if (!entry) return res.status(400).json({ error: "You don't have skins for that card yet." });
    if (style !== null && !entry.owned.includes(style)) return res.status(400).json({ error: "You don't own that skin." });
    entry.equipped = style;
    save();
    res.json({ ok: true });
});

// Show one card on your profile, in whatever skin it's wearing, or none (cardId: null)
shop.post("/api/me/showcase", signedIn, json, (req, res) => {
    const cardId = req.body?.cardId ?? null;
    if (cardId !== null && !store.cards.some(card => card.id === cardId)) return res.status(400).json({ error: "That card doesn't exist." });
    touchProfile(req.session.user).showcase = cardId; // Your name and picture too, in case you've never joined a room
    save();
    res.json({ ok: true });
});
