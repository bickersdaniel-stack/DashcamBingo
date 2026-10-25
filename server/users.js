// Admins see everyone who has signed in (or left a name on a card or suggestion), and can make admins,
// block people, fix win and coin counts, and set how many coins players earn
import { Router } from "express";
import { isOwner } from "./auth.js";
import { kickUser, refreshPlayer } from "./rooms.js";
import { allProfiles, cardTable, changeCoinSettings, coinSettings, getProfile, suggestionTable, updateProfile } from "./store.js";
import { adminOnly, json } from "./suggestions.js";

export const users = Router();
const signedInWith = id => id.startsWith("google:") ? "google" : id.startsWith("email:") ? "email" : "discord";

users.get("/api/admin/users", adminOnly, (req, res) => res.json(listAdminUsers()));

// Profiles first, then anyone we only know from a suggestion or card they sent
export function listAdminUsers() {
    const people = new Map(Object.entries(allProfiles()));
    const suggestions = suggestionTable.all();
    for (const { by } of [...suggestions, ...cardTable.all()]) {
        if (by?.id && !people.has(by.id)) people.set(by.id, { name: by.name, wins: 0 });
    }
    return [...people].map(([id, profile]) => {
        const theirs = suggestions.filter(s => s.by?.id === id);
        return {
            id, name: profile.name ?? "Someone", avatar: profile.avatar ?? "", via: signedInWith(id),
            wins: profile.wins ?? 0, coins: profile.coins ?? 0, seenAt: profile.seenAt ?? null,
            owner: isOwner(id), admin: isOwner(id) || profile.admin === true, blocked: profile.blocked === true,
            suggested: theirs.length, approved: theirs.filter(s => s.status === "approved").length
        };
    }).sort((a, b) => (b.seenAt ?? 0) - (a.seenAt ?? 0) || a.name.localeCompare(b.name));
}

function knownName(id) {
    return [...suggestionTable.all(), ...cardTable.all()].find(item => item.by?.id === id)?.by?.name;
}

// What's wrong with a change to someone, if anything. Owners stay admins, and nobody can lock themselves out
export function userChangeProblem(id, profile, changes, myId) {
    const { wins, coins, admin, blocked } = changes;
    if (wins !== undefined && !(Number.isInteger(wins) && wins >= 0 && wins <= 100_000)) return "Wins must be a whole number from 0 to 100000.";
    if (coins !== undefined && !(Number.isInteger(coins) && coins >= 0 && coins <= 1_000_000)) return "Coins must be a whole number from 0 to 1000000.";
    if ([admin, blocked].some(value => value !== undefined && typeof value !== "boolean")) return "Admin and blocked are yes or no.";
    if (isOwner(id) && (admin === false || blocked === true)) return "Owners in ADMIN_IDS stay admins and can't be blocked.";
    if (id === myId && (admin === false || blocked === true)) return "You can't remove your own admin or block yourself.";
    if (blocked === true && (admin ?? profile.admin) === true) return "Remove their admin first.";
    if (admin === true && (blocked ?? profile.blocked) === true) return "Unblock them first.";
    return null;
}

users.patch("/api/admin/users/:id", adminOnly, json, (req, res) => {
    const id = req.params.id;
    const name = knownName(id);
    if (!getProfile(id) && !name) return res.status(404).json({ error: "Nobody with that id has signed in." });
    const changes = { wins: req.body?.wins, coins: req.body?.coins, admin: req.body?.admin, blocked: req.body?.blocked };
    // Someone known only from a suggestion or card gets a profile with that name
    const result = updateProfile(id, profile => {
        profile.name ??= name;
        const problem = userChangeProblem(id, profile, changes, req.session.user.id);
        if (problem) return { error: problem };
        for (const [key, value] of Object.entries(changes)) if (value !== undefined) profile[key] = value;
        return { blocked: profile.blocked === true };
    });
    if (result.error) return res.status(400).json(result);
    if (result.blocked) kickUser(id);
    else refreshPlayer(id);
    res.json({ ok: true });
});

// What's wrong with new coin numbers, if anything; ones left out stay as they are
export function settingsProblem(changes) {
    const bad = Object.values(changes).some(value => value !== undefined && !(Number.isInteger(value) && value >= 0 && value <= 10_000));
    return bad ? "Coin numbers must be whole numbers from 0 to 10000." : null;
}

users.get("/api/admin/settings", adminOnly, (req, res) => res.json(coinSettings()));

users.patch("/api/admin/settings", adminOnly, json, (req, res) => {
    const changes = { bingoCoins: req.body?.bingoCoins, coinsPerRound: req.body?.coinsPerRound, countCoinsPerDay: req.body?.countCoinsPerDay };
    const problem = settingsProblem(changes);
    if (problem) return res.status(400).json({ error: problem });
    changeCoinSettings(changes);
    res.json(coinSettings());
});
