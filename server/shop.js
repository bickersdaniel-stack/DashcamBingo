// The shop: spend coins on rolls for card skins (a style on one card), or buy the one you want outright, collect
// them, and wear them on your squares.
// Coins only come from playing; nothing here costs real money
import { randomInt } from "node:crypto";
import { Router } from "express";
import { recordProgress } from "./achievements.js";
import { refreshPlayer } from "./rooms.js";
import { save, store, sydneyDay, touchProfile } from "./store.js";
import { json, signedIn } from "./suggestions.js";

export const rollCost = 100;
export const duplicateRefund = 25;
export const pityAfter = 10; // After this many rolls without an epic or better, the next one is

// price: buying one outright, dearer than a roll so rolling stays the cheap gamble
export const rarities = [
    { id: "common", name: "Common", weight: 60, price: 150 },
    { id: "rare", name: "Rare", weight: 28, price: 300 },
    { id: "epic", name: "Epic", weight: 10, price: 600 },
    { id: "legendary", name: "Legendary", weight: 2, price: 1500 }
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

// Everything else the shop sells, bought once and worn in its slot (kind). Frames, banners and stamps are drawn in
// styles.css (.frame-<id>, .banner-<id>, .stamp-<id>); a title is its name under yours. Reaction packs are just owned:
// their emojis join the free ones. A celebration's pieces rain (or burst) over the room when you get bingo.
// Ids are unique across every kind
export const extras = [
    { id: "gold-ring", kind: "frame", name: "Gold ring", price: 300 },
    { id: "hazard-tape", kind: "frame", name: "Hazard tape", price: 250 },
    { id: "police-lights", kind: "frame", name: "Police lights", price: 600 },
    { id: "rainbow-road", kind: "frame", name: "Rainbow road", price: 800 },
    { id: "paint-school-zone", kind: "frame", name: "School zone yellow", price: 100 },
    { id: "paint-hi-vis", kind: "frame", name: "Hi-vis orange", price: 100 },
    { id: "paint-stop-sign", kind: "frame", name: "Stop sign red", price: 100 },
    { id: "paint-road-sign-green", kind: "frame", name: "Road sign green", price: 100 },
    { id: "paint-police-blue", kind: "frame", name: "Police blue", price: 100 },
    { id: "paint-jacaranda", kind: "frame", name: "Jacaranda", price: 100 },
    { id: "paint-red-dirt", kind: "frame", name: "Red dirt", price: 100 },
    { id: "paint-bitumen-black", kind: "frame", name: "Bitumen black", price: 100 },
    { id: "paint-sunrise", kind: "frame", name: "Sunrise", price: 200 },
    { id: "paint-ocean-drive", kind: "frame", name: "Ocean drive", price: 200 },
    { id: "paint-jacaranda-bloom", kind: "frame", name: "Jacaranda bloom", price: 200 },
    { id: "paint-gum-tree", kind: "frame", name: "Gum tree", price: 200 },
    { id: "paint-brake-lights", kind: "frame", name: "Brake lights", price: 200 },
    { id: "paint-southern-lights", kind: "frame", name: "Southern lights", price: 200 },
    { id: "backseat-driver", kind: "title", name: "Backseat driver", price: 150 },
    { id: "indicator-enthusiast", kind: "title", name: "Indicator enthusiast", price: 150 },
    { id: "roundabout-royalty", kind: "title", name: "Roundabout royalty", price: 200 },
    { id: "certified-hoon", kind: "title", name: "Certified hoon", price: 200 },
    { id: "lollipop-person", kind: "title", name: "Lollipop person", price: 250 },
    { id: "road-warrior", kind: "title", name: "Road warrior", price: 400 },
    { id: "outback-dusk", kind: "banner", name: "Outback dusk", price: 300 },
    { id: "coastal-road", kind: "banner", name: "Coastal road", price: 300 },
    { id: "fresh-bitumen", kind: "banner", name: "Fresh bitumen", price: 400 },
    { id: "night-drive", kind: "banner", name: "Night drive", price: 600 },
    { id: "school-zone", kind: "banner", name: "School zone yellow", price: 100 },
    { id: "hi-vis", kind: "banner", name: "Hi-vis orange", price: 100 },
    { id: "stop-sign", kind: "banner", name: "Stop sign red", price: 100 },
    { id: "road-sign-green", kind: "banner", name: "Road sign green", price: 100 },
    { id: "police-blue", kind: "banner", name: "Police blue", price: 100 },
    { id: "jacaranda", kind: "banner", name: "Jacaranda", price: 100 },
    { id: "red-dirt", kind: "banner", name: "Red dirt", price: 100 },
    { id: "bitumen-black", kind: "banner", name: "Bitumen black", price: 100 },
    { id: "sunrise", kind: "banner", name: "Sunrise", price: 200 },
    { id: "ocean-drive", kind: "banner", name: "Ocean drive", price: 200 },
    { id: "jacaranda-bloom", kind: "banner", name: "Jacaranda bloom", price: 200 },
    { id: "gum-tree", kind: "banner", name: "Gum tree", price: 200 },
    { id: "brake-lights", kind: "banner", name: "Brake lights", price: 200 },
    { id: "southern-lights", kind: "banner", name: "Southern lights", price: 200 },
    { id: "aussie-pack", kind: "reactions", name: "Aussie pack", emojis: ["🦘", "🐨", "🍺", "🔥"], price: 200 },
    { id: "road-rage-pack", kind: "reactions", name: "Road rage pack", emojis: ["😡", "🤬", "🚨", "💥"], price: 200 },
    { id: "facepalm-pack", kind: "reactions", name: "Facepalm pack", emojis: ["🤦", "🙈", "💀", "🫠"], price: 250 },
    { id: "confetti", kind: "celebration", name: "Confetti", icon: "🎊", pieces: [""], price: 300 },
    { id: "fender-bender", kind: "celebration", name: "Fender bender", icon: "🚗💥", pieces: ["🚗", "💥", "🚙", "🛻"], price: 400 },
    { id: "fireworks", kind: "celebration", name: "Fireworks", icon: "🎆", pieces: ["✨", "🎆", "🎇"], price: 500 },
    { id: "roo-stampede", kind: "celebration", name: "Roo stampede", icon: "🦘", pieces: ["🦘"], price: 600 },
    { id: "big-tick", kind: "stamp", name: "Big tick", price: 200 },
    { id: "star", kind: "stamp", name: "Star", price: 250 },
    { id: "roo-prints", kind: "stamp", name: "Roo prints", price: 300 },
    { id: "paint-splat", kind: "stamp", name: "Paint splat", price: 400 }
];
export const wearable = ["frame", "title", "banner", "celebration", "stamp"];
export const freeReactions = ["👍", "😂", "😮"];

// The extra someone has on in a slot, or undefined
export const wornExtra = (profile, kind) => extras.find(e => e.kind === kind && e.id === profile.wearing?.[kind]);

// How someone looks to everyone else: their frame and banner ids, and their title's words
export function lookOf(profile) {
    return { frame: wornExtra(profile, "frame")?.id ?? null, title: wornExtra(profile, "title")?.name ?? null, banner: wornExtra(profile, "banner")?.id ?? null };
}

// The emojis someone can react with: the free ones and every pack they own
export const reactionsOf = profile => [...freeReactions, ...extras.filter(e => e.kind === "reactions" && profile.extras?.includes(e.id)).flatMap(e => e.emojis)];

// Buys an extra, which goes straight on if nothing's in its slot. Returns what you have now, or { error }
export function buyExtra(profile, id) {
    const extra = extras.find(e => e.id === id);
    if (!extra) return { error: "That isn't in the shop." };
    if (profile.extras?.includes(id)) return { error: "You already own that." };
    if ((profile.coins ?? 0) < extra.price) return { error: `That costs ${extra.price} coins.` };
    profile.coins -= extra.price;
    (profile.extras ??= []).push(id);
    if (wearable.includes(extra.kind)) (profile.wearing ??= {})[extra.kind] ??= id;
    return { coins: profile.coins, owned: profile.extras, wearing: profile.wearing ?? {} };
}

// Puts on an extra you own in its slot, or takes that slot off (id: null)
export function wearExtra(profile, kind, id) {
    if (!wearable.includes(kind)) return { error: "That can't be worn." };
    if (id !== null && !(profile.extras?.includes(id) && extras.find(e => e.id === id)?.kind === kind)) return { error: "You don't own that." };
    (profile.wearing ??= {})[kind] = id;
    return { wearing: profile.wearing };
}

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

// One skin you picked, for its rarity's price; it goes on if the card wears none. It doesn't count as rolling a
// legendary. Returns what you have now, or { error }
export function buySkin(profile, card, styleId) {
    const style = styles.find(s => s.id === styleId);
    if (!card || !style) return { error: "That skin doesn't exist." };
    if (profile.skins?.[card.id]?.owned.includes(style.id)) return { error: "You already own that skin." };
    const { price } = rarities.find(r => r.id === style.rarity);
    if ((profile.coins ?? 0) < price) return { error: `That skin costs ${price} coins.` };
    profile.coins -= price;
    const entry = (profile.skins ??= {})[card.id] ??= { owned: [], equipped: null };
    entry.owned.push(style.id);
    entry.equipped ??= style.id;
    const earned = recordProgress(profile, { skins: 1 });
    return {
        skin: skinInfo(style.id), equipped: entry.equipped, coins: profile.coins,
        achievements: earned.map(a => ({ name: a.name, description: a.description, coins: a.coins }))
    };
}

// Daily reward: claim once a Sydney day. Days in a row walk the 7 stops, the last paying most, then it starts over;
// missing a day starts it over too
export const dailyRewards = [10, 15, 20, 25, 30, 40, 100];
const dayBefore = day => new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10); // Midday, so no DST slip

// How many stops are done in this run, and whether today's is claimed
export function dailyStatus(profile, today) {
    const { day = null, step = 0 } = profile.daily ?? {};
    const claimed = day === today;
    return { rewards: dailyRewards, claimed, done: claimed ? step : day === dayBefore(today) ? step % dailyRewards.length : 0 };
}

export function claimDaily(profile, today) {
    const status = dailyStatus(profile, today);
    if (status.claimed) return { error: "You've had today's reward. Come back tomorrow." };
    const step = status.done + 1;
    profile.daily = { day: today, step };
    profile.coins = (profile.coins ?? 0) + dailyRewards[step - 1];
    return { coins: profile.coins, gained: dailyRewards[step - 1], daily: dailyStatus(profile, today) };
}

export const shop = Router();

shop.get("/api/shop", signedIn, (req, res) => {
    const profile = store.profiles[req.session.user.id] ?? {};
    const total = rarities.reduce((sum, r) => sum + r.weight, 0);
    res.json({
        coins: profile.coins ?? 0, cost: rollCost, refund: duplicateRefund, pity: profile.pity ?? 0, pityAfter, newSkins: profile.newSkins?.length ?? 0,
        rarities: rarities.map(r => ({ id: r.id, name: r.name, chance: Math.round(r.weight / total * 100), price: r.price })), styles,
        extras, wearable, freeReactions, owned: profile.extras ?? [], wearing: profile.wearing ?? {}, avatar: req.session.user.avatar,
        daily: dailyStatus(profile, sydneyDay())
    });
});

shop.post("/api/shop/daily", signedIn, (req, res) => {
    const result = claimDaily(touchProfile(req.session.user), sydneyDay()); // Your name too, in case you've never joined a room
    if (result.error) return res.status(400).json(result);
    save();
    res.json(result);
});

shop.post("/api/shop/roll", signedIn, (req, res) => {
    const profile = store.profiles[req.session.user.id] ??= { wins: 0 };
    const result = buy(profile, store.cards);
    if (result.error) return res.status(400).json(result);
    save();
    result.card.packName = store.packs.find(pack => pack.id === result.card.pack)?.name ?? "";
    res.json(result);
});

shop.post("/api/shop/buy", signedIn, json, (req, res) => {
    const profile = store.profiles[req.session.user.id] ??= { wins: 0 };
    const result = buySkin(profile, store.cards.find(card => card.id === req.body?.cardId), req.body?.style);
    if (result.error) return res.status(400).json(result);
    save();
    res.json(result);
});

shop.post("/api/shop/extras/buy", signedIn, json, (req, res) => {
    const profile = store.profiles[req.session.user.id] ??= { wins: 0 };
    const result = buyExtra(profile, req.body?.id);
    if (result.error) return res.status(400).json(result);
    save();
    refreshPlayer(req.session.user.id); // Rooms you're in show it straight away
    res.json(result);
});

shop.post("/api/me/wear", signedIn, json, (req, res) => {
    const result = wearExtra(store.profiles[req.session.user.id] ?? {}, req.body?.kind, req.body?.id ?? null);
    if (result.error) return res.status(400).json(result);
    save();
    refreshPlayer(req.session.user.id);
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
