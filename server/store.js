// What has to survive a restart: the cards and their packs, suggested squares, and each player's wins.
// One small JSON file in data/ (a Docker volume), replaced whole on each save so it's never half-written.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const folder = new URL("../data/", import.meta.url);
const file = new URL("store.json", folder);

export const store = { suggestions: [], profiles: {} };
try {
    Object.assign(store, JSON.parse(readFileSync(file, "utf8")));
} catch (error) {
    if (error.code !== "ENOENT") throw error; // A broken file should stop the server, not be quietly replaced
}
store.profiles ??= {};
const base = readFileSync(new URL("../docs/phrases.txt", import.meta.url), "utf8")
    .split("\n").map(line => line.trim()).filter(line => line !== "");
migrate(store, base);

// Older stores had the fixed list in phrases.txt plus approved suggestions; both become cards in one Core pack.
// The change stays in memory until the next save.
export function migrate(data, lines) {
    if (data.cards) return data;
    const now = Date.now();
    data.packs = [{ id: "core", name: "Core", description: "", on: true }];
    data.cards = [
        ...lines.map(text => ({ id: randomUUID(), text, by: null, at: now })),
        ...(data.approved ?? []).map(({ id, text, by, at }) => ({ id, text, by, at }))
    ].map(card => ({ ...card, description: "", pack: "core", dealt: 0, spotted: 0 }));
    delete data.approved;
    return data;
}

export const cardsIn = packIds => store.cards.filter(card => packIds.includes(card.pack));
export const defaultPacks = () => store.packs.filter(pack => pack.on).map(pack => pack.id);

// How often each card gets marked, for the admin page and for dealing a fair mix; unmarking takes it back off
export function countSpot(cardId, by) {
    const card = store.cards.find(card => card.id === cardId);
    if (!card) return;
    card.spotted = Math.max(0, card.spotted + by);
    save();
}

export function touchProfile(user) {
    const row = store.profiles[user.id] ??= { wins: 0 };
    row.name = user.name;
    row.avatar = user.avatar;
    row.seenAt = Date.now();
    save();
    return row;
}

// An admin can block someone from joining rooms and suggesting squares
export const isBlocked = id => store.profiles[id]?.blocked === true;

export function addWin(userId) {
    const row = store.profiles[userId] ??= { wins: 0 };
    row.wins++;
    save();
    return row.wins;
}

export function removeWin(userId) {
    const row = store.profiles[userId] ??= { wins: 0 };
    row.wins = Math.max(0, row.wins - 1);
    save();
    return row.wins;
}

// Coins: one for each new sighting (at most 60 a day from those), more for bingos, spent in the shop
export const countCoinsPerDay = 60;
const sydneyDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });

// The daily cap on a profile row; gives 1 coin, or 0 once today's 60 are used up
export function countCoin(row, day) {
    if (row.coinDay !== day) Object.assign(row, { coinDay: day, coinsToday: 0 });
    if (row.coinsToday >= countCoinsPerDay) return 0;
    row.coinsToday++;
    row.coins = (row.coins ?? 0) + 1;
    return 1;
}

export function earnCountCoin(userId) {
    const gained = countCoin(store.profiles[userId] ??= { wins: 0 }, sydneyDay());
    if (gained) save();
    return gained;
}

export function addCoins(userId, amount) {
    const row = store.profiles[userId] ??= { wins: 0 };
    row.coins = Math.max(0, (row.coins ?? 0) + amount);
    save();
    return row.coins;
}

export const coinsOf = userId => store.profiles[userId]?.coins ?? 0;

export function save() {
    mkdirSync(folder, { recursive: true });
    const temporary = new URL("store.json.tmp", folder);
    writeFileSync(temporary, JSON.stringify(store, null, 2));
    renameSync(temporary, file);
}
