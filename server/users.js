// Admins see everyone who has joined a room, and can make admins, block people, and fix win counts
import { Router } from "express";
import { isOwner } from "./auth.js";
import { kickUser, refreshPlayer } from "./rooms.js";
import { save, store } from "./store.js";
import { adminOnly, json } from "./suggestions.js";

export const users = Router();
const signedInWith = id => id.startsWith("google:") ? "google" : id.startsWith("email:") ? "email" : "discord";

users.get("/api/admin/users", adminOnly, (req, res) => {
    res.json(Object.entries(store.profiles).map(([id, profile]) => {
        const theirs = store.suggestions.filter(s => s.by.id === id);
        return {
            id, name: profile.name ?? "Someone", avatar: profile.avatar ?? "", via: signedInWith(id),
            wins: profile.wins ?? 0, seenAt: profile.seenAt ?? null,
            owner: isOwner(id), admin: isOwner(id) || profile.admin === true, blocked: profile.blocked === true,
            suggested: theirs.length, approved: theirs.filter(s => s.status === "approved").length
        };
    }).sort((a, b) => (b.seenAt ?? 0) - (a.seenAt ?? 0) || a.name.localeCompare(b.name)));
});

// What's wrong with a change to someone, if anything. Owners stay admins, and nobody can lock themselves out
export function userChangeProblem(id, profile, changes, myId) {
    const { wins, admin, blocked } = changes;
    if (wins !== undefined && !(Number.isInteger(wins) && wins >= 0 && wins <= 100_000)) return "Wins must be a whole number from 0 to 100000.";
    if ([admin, blocked].some(value => value !== undefined && typeof value !== "boolean")) return "Admin and blocked are yes or no.";
    if (isOwner(id) && (admin === false || blocked === true)) return "Owners in ADMIN_IDS stay admins and can't be blocked.";
    if (id === myId && (admin === false || blocked === true)) return "You can't remove your own admin or block yourself.";
    if (blocked === true && (admin ?? profile.admin) === true) return "Remove their admin first.";
    if (admin === true && (blocked ?? profile.blocked) === true) return "Unblock them first.";
    return null;
}

users.patch("/api/admin/users/:id", adminOnly, json, (req, res) => {
    const id = req.params.id;
    const profile = store.profiles[id];
    if (!profile) return res.status(404).json({ error: "Nobody with that id has joined a room." });
    const changes = { wins: req.body?.wins, admin: req.body?.admin, blocked: req.body?.blocked };
    const problem = userChangeProblem(id, profile, changes, req.session.user.id);
    if (problem) return res.status(400).json({ error: problem });
    for (const [key, value] of Object.entries(changes)) if (value !== undefined) profile[key] = value;
    save();
    if (profile.blocked) kickUser(id);
    else refreshPlayer(id);
    res.json({ ok: true });
});
