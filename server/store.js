// What has to survive a restart: suggested squares and the extra squares admins approved.
// One small JSON file in data/ (a Docker volume), replaced whole on each save so it's never half-written.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const folder = new URL("../data/", import.meta.url);
const file = new URL("store.json", folder);

export const store = { suggestions: [], approved: [], profiles: {} };
try {
    Object.assign(store, JSON.parse(readFileSync(file, "utf8")));
} catch (error) {
    if (error.code !== "ENOENT") throw error; // A broken file should stop the server, not be quietly replaced
}
store.profiles ??= {};

export function touchProfile(user) {
    const row = store.profiles[user.id] ??= { wins: 0 };
    row.name = user.name;
    row.avatar = user.avatar;
    save();
    return row;
}

export function addWin(userId) {
    const row = store.profiles[userId] ??= { wins: 0 };
    row.wins++;
    save();
    return row.wins;
}

export function save() {
    mkdirSync(folder, { recursive: true });
    const temporary = new URL("store.json.tmp", folder);
    writeFileSync(temporary, JSON.stringify(store, null, 2));
    renameSync(temporary, file);
}

const base = readFileSync(new URL("../docs/phrases.txt", import.meta.url), "utf8")
    .split("\n").map(line => line.trim()).filter(line => line !== "");

// Every square a card can have: the built-in list plus the approved suggestions
export function allPhrases() {
    return [...base, ...store.approved.map(square => square.text)];
}
