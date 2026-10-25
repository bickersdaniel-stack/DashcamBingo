// What has to survive a restart: the cards and their packs, suggested squares, each player's profile and the coin
// settings, in a SQLite database in data/ (a Docker volume). Each row holds one of them as JSON, and every change
// reads, edits and writes its row back in one transaction, so two servers on the same file can't undo each other.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

// DATA_DIR: the folder for the database (data/ unless set). :memory: never touches a file, and is what any run under
// node --test gets unless told otherwise, so a test can't reach the live data
const dataDir = process.env.DATA_DIR ?? (process.env.NODE_TEST_CONTEXT ? ":memory:" : fileURLToPath(new URL("../data/", import.meta.url)));
const inMemory = dataDir === ":memory:";
if (!inMemory) mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(inMemory ? ":memory:" : join(dataDir, "bingo.db"));
db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS packs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS suggestions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS modes (id TEXT PRIMARY KEY, data TEXT NOT NULL);
`);

let depth = 0;
// Runs fn in one transaction, or inside the one already running, so everything it reads and writes lands together.
// IMMEDIATE takes the write lock up front, so another server can't change a row between our read and write
export function transaction(fn) {
    if (depth > 0) return fn();
    db.exec("BEGIN IMMEDIATE");
    depth++;
    try {
        const result = fn();
        db.exec("COMMIT");
        return result;
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    } finally {
        depth--;
    }
}

// One table of JSON rows, kept in the order they were added
function table(name) {
    const all = db.prepare(`SELECT id, data FROM ${name} ORDER BY rowid`);
    const one = db.prepare(`SELECT data FROM ${name} WHERE id = ?`);
    const put = db.prepare(`INSERT INTO ${name} (id, data) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data`);
    const remove = db.prepare(`DELETE FROM ${name} WHERE id = ?`);
    const rows = {
        all: () => all.all().map(row => JSON.parse(row.data)),
        entries: () => all.all().map(row => [row.id, JSON.parse(row.data)]),
        get: id => { const row = one.get(String(id)); return row && JSON.parse(row.data); }, // String: ids from requests can be anything
        put: (id, doc) => { put.run(String(id), JSON.stringify(doc)); },
        remove: id => { remove.run(String(id)); },
        // Reads the row (or starts one with fresh()), lets change() edit it, and writes it back. Returns what change()
        // returns; a result with an error writes nothing, since checks come before changes. No row and no fresh(): nothing
        update: (id, change, fresh) => transaction(() => {
            const doc = rows.get(id) ?? fresh?.();
            if (!doc) return undefined;
            const result = change(doc);
            if (!result?.error) rows.put(id, doc);
            return result;
        })
    };
    return rows;
}

export const profileTable = table("profiles");
export const cardTable = table("cards");
export const packTable = table("packs");
export const suggestionTable = table("suggestions");
export const modeTable = table("modes"); // Game modes: which cards a room deals from, picked before packs
const settingTable = table("settings");

export const getProfile = id => profileTable.get(id);
export const allProfiles = () => Object.fromEntries(profileTable.entries()); // Player id -> profile
// Changes someone's profile, starting one if they haven't got one yet
export const updateProfile = (id, change) => profileTable.update(id, change, () => ({ wins: 0 }));

// Older stores had the fixed list in phrases.txt plus approved suggestions; both become cards in one Core pack
export function migrate(data, lines) {
    if (data.cards) return data;
    const now = Date.now();
    data.packs = [{ id: "core", name: "Core", description: "", on: true }];
    data.cards = [
        ...lines.map(text => ({ id: randomUUID(), text, by: null, at: now })),
        ...(data.approved ?? []).map(({ id, text, by, at }) => ({ id, text, by, at }))
    ].map(card => ({ ...card, description: "", pack: "core", dealt: 0, spotted: 0, counted: 0 }));
    delete data.approved;
    return data;
}

// First start on the database: bring in the old store.json (then rename it so it's never read again), or on a new
// install start the Core pack from phrases.txt
const phrases = readFileSync(new URL("../docs/phrases.txt", import.meta.url), "utf8")
    .split("\n").map(line => line.trim()).filter(line => line !== "");
const oldFile = inMemory ? null : join(dataDir, "store.json");
const imported = transaction(() => {
    if (db.prepare("SELECT count(*) AS n FROM cards").get().n > 0) return false;
    const data = oldFile && existsSync(oldFile) ? JSON.parse(readFileSync(oldFile, "utf8")) : {}; // A broken file stops the server
    migrate(data, phrases);
    for (const [id, profile] of Object.entries(data.profiles ?? {})) profileTable.put(id, profile);
    for (const card of data.cards) cardTable.put(card.id, card);
    for (const pack of data.packs) packTable.put(pack.id, pack);
    for (const suggestion of data.suggestions ?? []) suggestionTable.put(suggestion.id, suggestion);
    if (data.settings) settingTable.put("coins", data.settings);
    return true;
});
if (imported && oldFile && existsSync(oldFile)) renameSync(oldFile, join(dataDir, "store.imported.json"));

// Normal, which is every card until an admin unticks it, and Police Karma to start; admins add more
transaction(() => {
    if (db.prepare("SELECT count(*) AS n FROM modes").get().n > 0) return;
    modeTable.put("normal", { id: "normal", name: "Normal", description: "" });
    modeTable.put("police-karma", { id: "police-karma", name: "Police Karma", description: "" });
});

// The game modes a card is dealt in; cards from before modes are Normal
export const modesOf = card => card.modes ?? ["normal"];
export const cardsIn = (packIds, mode = "normal") => cardTable.all().filter(card => packIds.includes(card.pack) && modesOf(card).includes(mode));
export const defaultPacks = () => packTable.all().filter(pack => pack.on).map(pack => pack.id);

// How often each card gets marked (spotted, for the admin page and dealing a fair mix) and every sighting
// counted on it (counted, for the leaderboard); taking one off takes it back off
export function countSpot(cardId, spotted, counted) {
    cardTable.update(cardId, card => {
        card.spotted = Math.max(0, card.spotted + spotted);
        card.counted = Math.max(0, (card.counted ?? 0) + counted);
    });
}

// Each card on a newly dealt card counts as dealt once, for the spotted rate
export const markDealt = cardIds => transaction(() => {
    for (const id of cardIds) cardTable.update(id, card => { card.dealt++; });
});

export const touchProfile = user => updateProfile(user.id, row => Object.assign(row, { name: user.name, avatar: user.avatar, seenAt: Date.now() }));

// An admin can block someone from joining rooms and suggesting squares
export const isBlocked = id => getProfile(id)?.blocked === true;

export const addWin = userId => updateProfile(userId, row => row.wins = (row.wins ?? 0) + 1);
export const removeWin = userId => updateProfile(userId, row => row.wins = Math.max(0, (row.wins ?? 0) - 1));

// Coins: one for each new sighting (capped each day), more for bingos, spent in the shop. Admins can change
// the numbers; a round's cap counts both on one card, so nobody can farm a round
export const coinSettings = () => ({ bingoCoins: 25, countCoinsPerDay: 60, coinsPerRound: 100, ...settingTable.get("coins") });
// Only the numbers given change; the rest keep their value
export const changeCoinSettings = changes => settingTable.update("coins", row => {
    for (const [key, value] of Object.entries(changes)) if (value !== undefined) row[key] = value;
}, () => ({}));
export const sydneyDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });

// The daily cap on a profile row; gives 1 coin, or 0 once today's are used up
export function countCoin(row, day, cap = coinSettings().countCoinsPerDay) {
    if (row.coinDay !== day) Object.assign(row, { coinDay: day, coinsToday: 0 });
    if (row.coinsToday >= cap) return 0;
    row.coinsToday++;
    row.coins = (row.coins ?? 0) + 1;
    return 1;
}

export const earnCountCoin = userId => updateProfile(userId, row => countCoin(row, sydneyDay()));
export const addCoins = (userId, amount) => updateProfile(userId, row => row.coins = Math.max(0, (row.coins ?? 0) + amount));
export const coinsOf = userId => getProfile(userId)?.coins ?? 0;
