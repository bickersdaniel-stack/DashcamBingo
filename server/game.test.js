import assert from "node:assert/strict";
import test from "node:test";
import { applyCount, coinsLeft, payBingo, refundBingo } from "./rooms.js";
import { changeCoinSettings, countCoin, db } from "./store.js";

const freshCard = () => ({ counts: Array(25).fill(0), peak: Array(25).fill(0), marked: new Set() });

test("applyCount marks from one up, unmarks at zero, and stays between 0 and 99", () => {
    const card = freshCard();
    assert.deepEqual(applyCount(card, 3, 1), { count: 1, marked: true, unmarked: false, coin: true });
    assert.ok(card.marked.has(3));
    assert.deepEqual(applyCount(card, 3, 1), { count: 2, marked: false, unmarked: false, coin: true });
    assert.deepEqual(applyCount(card, 3, -1), { count: 1, marked: false, unmarked: false, coin: false });
    assert.deepEqual(applyCount(card, 3, -1), { count: 0, marked: false, unmarked: true, coin: false });
    assert.ok(!card.marked.has(3));
    assert.equal(applyCount(card, 3, -1), null, "can't go below zero");
    card.counts[4] = card.peak[4] = 99;
    card.marked.add(4);
    assert.equal(applyCount(card, 4, 1), null, "can't go above 99");
});

test("applyCount only pays a coin for a new high, so taking one off and adding it back earns nothing", () => {
    const card = freshCard();
    applyCount(card, 0, 1);
    applyCount(card, 0, 1);
    applyCount(card, 0, -1);
    assert.equal(applyCount(card, 0, 1).coin, false, "back up to 2 again");
    assert.equal(applyCount(card, 0, 1).coin, true, "3 is new");
});

test("countCoin stops at the daily cap and starts again the next day", () => {
    const row = { wins: 0 };
    let total = 0;
    for (let i = 0; i < 15; i++) total += countCoin(row, "2026-10-24", 5);
    assert.equal(total, 5);
    assert.equal(row.coins, 5);
    assert.equal(countCoin(row, "2026-10-25", 5), 1);
    assert.equal(row.coinsToday, 1);
    for (let i = 0; i < 70; i++) countCoin(row, "2026-10-26");
    assert.equal(row.coinsToday, 60, "the default cap");
});

// Admin changes to the coin numbers live in the settings table; tests run on an in-memory database
const withSettings = (settings, run) => {
    changeCoinSettings(settings);
    try { run(); } finally { db.exec("DELETE FROM settings"); }
};

test("the round cap stops count coins once a card has earned its share", () => withSettings({ coinsPerRound: 10 }, () => {
    const card = { coinsEarned: 9 };
    assert.equal(coinsLeft(card), 1);
    card.coinsEarned = 10;
    assert.equal(coinsLeft(card), 0);
    changeCoinSettings({ coinsPerRound: 4 }); // Lowered mid-round
    assert.equal(coinsLeft(card), 0);
}));

test("a BINGO over the round cap pays only what's left, and unwinning takes back exactly that", () => withSettings({ coinsPerRound: 100, bingoCoins: 25 }, () => {
    const card = { coinsEarned: 90, bingoPaid: 0 };
    assert.equal(payBingo(card), 10);
    assert.equal(card.coinsEarned, 100);
    assert.equal(refundBingo(card), 10);
    assert.deepEqual(card, { coinsEarned: 90, bingoPaid: 0 });
    card.coinsEarned = 0;
    assert.equal(payBingo(card), 25, "the full amount with room to spare");
}));

test("settingsProblem takes whole numbers from 0 to 10000 and rejects the rest", async () => {
    const { settingsProblem } = await import("./users.js");
    assert.equal(settingsProblem({ bingoCoins: 0, coinsPerRound: 10_000, countCoinsPerDay: undefined }), null);
    for (const junk of [-1, 1.5, "10", 10_001, null, NaN, true]) assert.match(settingsProblem({ bingoCoins: junk }), /whole numbers/, String(junk));
});

test("rankPlayers lists winners most first, shares places on a tie, and leaves out the blocked and winless", async () => {
    const { rankPlayers } = await import("./leaderboard.js");
    const rows = rankPlayers({
        a: { name: "Ann", wins: 5 }, b: { name: "Bob", wins: 3 }, c: { name: "Cat", wins: 3 },
        d: { name: "Dan", wins: 1 }, e: { name: "Eve", wins: 0 }, f: { name: "Fay", wins: 9, blocked: true }
    });
    assert.deepEqual(rows.map(r => [r.name, r.rank]), [["Ann", 1], ["Bob", 2], ["Cat", 2], ["Dan", 4]]);
});

test("rankCards ranks cards with enough games by spotted rate and flags the least spotted as rare", async () => {
    const { rankCards } = await import("./leaderboard.js");
    const packs = [{ id: "core", name: "Core" }];
    const cards = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, text: `Card ${i}`, pack: "core", dealt: 20, spotted: 20 - i * 2, counted: i }));
    cards.push({ id: "new", text: "New card", pack: "core", dealt: 3, spotted: 1 });
    const rows = rankCards(cards, packs);
    assert.deepEqual(rows.slice(0, 2).map(r => [r.id, r.rate]), [["c0", 100], ["c1", 90]]);
    assert.equal(rows.at(-1).id, "new", "too few games go last");
    assert.equal(rows.at(-1).rate, null);
    assert.deepEqual(rows.filter(r => r.rare).map(r => r.id), ["c3", "c4", "c5", "c6", "c7"]);
    assert.equal(rows[0].pack, "Core");
});

test("recordProgress unlocks achievements once, pays their coins, and handles one-off moments", async () => {
    const { recordProgress } = await import("./achievements.js");
    const profile = { wins: 1, coins: 0 };
    let earned = recordProgress(profile, { counts: 1 });
    assert.deepEqual(earned.map(a => a.id), ["first-blood"], "wins on the profile count");
    assert.equal(profile.coins, 20);
    assert.deepEqual(recordProgress(profile, { counts: 1 }), [], "only once");

    for (let i = 0; i < 19; i++) recordProgress(profile, { swears: 1 });
    assert.deepEqual(recordProgress(profile, { swears: 1 }).map(a => a.id), ["potty-mouth"]);
    assert.equal(profile.stats.swears, 20);

    assert.deepEqual(recordProgress(profile, {}, { count: 5 }).map(a => a.id), ["tally-ho"]);
    assert.deepEqual(recordProgress(profile, {}, { marked: 24 }).map(a => a.id), ["blackout"]);
    assert.deepEqual(recordProgress(profile, {}, { bingoMs: 60_000 }).map(a => a.id), ["speedrun"]);
    assert.deepEqual(recordProgress(profile, {}, { hour: 2 }).map(a => a.id), ["night-shift"]);
    assert.deepEqual(recordProgress(profile, {}, { bingoMs: 600_000, hour: 12, count: 2, marked: 3 }), [], "nothing for an ordinary moment");
});

// The same "random" numbers every run: random(n) gives 0 to n - 1
function seeded(seed) {
    return n => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return Math.floor(seed / 2147483648 * n);
    };
}
const shopCards = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, text: `Card ${i}`, pack: "core" }));

test("roll lands on each rarity about as often as the odds say", async () => {
    const { roll } = await import("./shop.js");
    const random = seeded(42);
    const counts = { common: 0, rare: 0, epic: 0, legendary: 0 };
    for (let i = 0; i < 20000; i++) counts[roll(shopCards, { pity: 0 }, random).rarity.id]++;
    const share = id => counts[id] / 20000 * 100;
    assert.ok(Math.abs(share("common") - 60) < 2, `common ${share("common")}%`);
    assert.ok(Math.abs(share("rare") - 28) < 2, `rare ${share("rare")}%`);
    assert.ok(Math.abs(share("epic") - 10) < 1.5, `epic ${share("epic")}%`);
    assert.ok(Math.abs(share("legendary") - 2) < 0.7, `legendary ${share("legendary")}%`);
});

test("buy takes the coins, puts a card's first skin on, refunds duplicates, and guarantees an epic after 10 misses", async () => {
    const { buy, rollCost, duplicateRefund, pityAfter } = await import("./shop.js");
    assert.match(buy({ coins: 50 }, shopCards).error, /costs 100 coins/);

    const profile = { coins: rollCost * 3 };
    const first = buy(profile, shopCards, seeded(1));
    assert.equal(profile.skins[first.card.id].equipped, first.skin.id, "first skin goes on");
    assert.equal(first.worn, true, "and says so");
    assert.deepEqual(profile.newSkins, [first.card.id], "new until the Cards page is opened");
    assert.equal(first.newSkins, 1);
    assert.equal(profile.coins, rollCost * 2);

    // The same card and style again: a duplicate, with coins back
    const again = buy(profile, [shopCards.find(c => c.id === first.card.id)], seeded(1));
    if (again.skin.id === first.skin.id) {
        assert.equal(again.duplicate, true);
        assert.equal(again.worn, false);
        assert.equal(profile.newSkins.length, 1, "a repeat isn't new");
        assert.equal(profile.coins, rollCost + duplicateRefund);
    }

    // Ten rolls with no epic or better, then the next one is
    const unlucky = { coins: 0, pity: pityAfter };
    unlucky.coins = rollCost;
    const pityRoll = buy(unlucky, shopCards, () => 0); // Would be common without the guarantee
    assert.ok(["epic", "legendary"].includes(pityRoll.skin.rarity));
    assert.equal(unlucky.pity, 0, "the count starts again");
    const ordinary = { coins: rollCost, pity: 3 };
    assert.equal(buy(ordinary, shopCards, () => 0).skin.rarity, "common");
    assert.equal(ordinary.pity, 4);
});
