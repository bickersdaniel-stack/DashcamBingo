// Achievements: lifetime stats on each profile and the goals they unlock, each worth some coins.
// Some are just for a laugh; those show a hint until they're earned, rather than giving the game away
import { Router } from "express";
import { store } from "./store.js";
import { signedIn } from "./suggestions.js";

// stat + goal: counted over a lifetime (and shown as progress). check: something that happens in one moment
export const achievements = [
    { id: "first-blood", name: "First blood", description: "Get your first bingo.", coins: 20, stat: "wins", goal: 1 },
    { id: "hat-trick", name: "Hat trick", description: "Get 3 bingos.", coins: 40, stat: "wins", goal: 3 },
    { id: "bingo-veteran", name: "Bingo veteran", description: "Get 25 bingos.", coins: 100, stat: "wins", goal: 25 },
    { id: "eagle-eye", name: "Eagle eye", description: "Be first in the room to spot something, 25 times.", coins: 40, stat: "firsts", goal: 25 },
    { id: "potty-mouth", name: "Potty mouth", description: "Count \"says …\" squares 20 times.", hint: "Some squares are a bit rude…", coins: 30, stat: "swears", goal: 20 },
    { id: "ute-whisperer", name: "Ute whisperer", description: "Count ute squares 10 times.", hint: "Every Aussie dashcam has one.", coins: 25, stat: "utes", goal: 10 },
    { id: "butterfingers", name: "Butterfingers", description: "Take back 15 counts.", hint: "Oops.", coins: 15, stat: "takeBacks", goal: 15 },
    { id: "so-close", name: "So close", description: "End a round one away from bingo, 5 times.", hint: "Close, but no bingo.", coins: 20, stat: "soClose", goal: 5 },
    { id: "blackout", name: "Blackout", description: "Mark all 24 squares in one round.", hint: "Leave no square unmarked.", coins: 75, check: moment => moment.marked >= 24 },
    { id: "tally-ho", name: "Tally ho", description: "Count one square 5 times in a round.", hint: "Same thing, again and again.", coins: 20, check: moment => moment.count >= 5 },
    { id: "reroll-addict", name: "Reroll addict", description: "Use 20 rerolls.", coins: 15, stat: "rerolls", goal: 20 },
    { id: "host-with-the-most", name: "Host with the most", description: "Host 10 rounds.", coins: 40, stat: "roundsHosted", goal: 10 },
    { id: "speedrun", name: "Speedrun", description: "Get bingo within 3 minutes of a round starting.", coins: 50, check: moment => moment.bingoMs < 3 * 60 * 1000 },
    { id: "night-shift", name: "Night shift", description: "Play between 1am and 4am, Sydney time.", hint: "Shouldn't you be asleep?", coins: 20, check: moment => moment.hour >= 1 && moment.hour < 4 },
    { id: "lucky-dip", name: "Lucky dip", description: "Roll a legendary skin in the shop.", hint: "Feeling lucky?", coins: 0, stat: "legendaries", goal: 1 },
    { id: "collector", name: "Collector", description: "Own 15 skins.", coins: 50, stat: "skins", goal: 15 }
];

// wins lives on the profile itself (admins can edit it); everything else is under stats
const statOf = (profile, stat) => stat === "wins" ? profile.wins ?? 0 : profile.stats?.[stat] ?? 0;

// Adds to a profile's stats, then unlocks (and pays for) anything newly earned, which it returns. moment holds
// what just happened, for the one-off achievements: count, marked, bingoMs, hour
export function recordProgress(profile, changes = {}, moment = {}) {
    const stats = profile.stats ??= {};
    for (const [stat, by] of Object.entries(changes)) if (by) stats[stat] = (stats[stat] ?? 0) + by;
    profile.achievements ??= {};
    const earned = achievements.filter(a => !profile.achievements[a.id] && (a.check ? a.check(moment) : statOf(profile, a.stat) >= a.goal));
    for (const a of earned) {
        profile.achievements[a.id] = Date.now();
        profile.coins = (profile.coins ?? 0) + a.coins;
    }
    return earned;
}

export const sydneyHour = () => Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hourCycle: "h23" }).format(new Date()));

export const achievementRoutes = Router();

// Everything there is to earn, what you've earned, and how far along the rest are
achievementRoutes.get("/api/me/achievements", signedIn, (req, res) => {
    const profile = store.profiles[req.session.user.id] ?? {};
    res.json(achievements.map(a => {
        const earnedAt = profile.achievements?.[a.id] ?? null;
        return {
            id: a.id, name: a.name, coins: a.coins, earnedAt,
            description: earnedAt || !a.hint ? a.description : a.hint,
            progress: a.stat ? [Math.min(statOf(profile, a.stat), a.goal), a.goal] : null
        };
    }));
});
