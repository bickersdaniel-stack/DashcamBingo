// Leaderboard page: your numbers, the players with the most bingos, the achievements you're closest to,
// and the cards spotted most often
import { cardRow, playerRow } from "./board.js";

const $ = id => document.getElementById(id);
const tabFor = id => document.querySelector(`.tab[aria-controls="${id}"]`);

document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => selectTab(tab)));
addEventListener("hashchange", () => selectTab(tabFor(location.hash === "#cards" ? "cardsPanel" : "playersPanel")));
if (location.hash === "#cards") selectTab(tabFor("cardsPanel"));

function selectTab(tab) {
    document.querySelectorAll(".tab").forEach(other => {
        other.setAttribute("aria-selected", other === tab);
        $(other.getAttribute("aria-controls")).hidden = other !== tab;
    });
    const cards = tab.getAttribute("aria-controls") === "cardsPanel";
    $("navLeaderboard").removeAttribute("aria-current");
    $("navCards").removeAttribute("aria-current");
    (cards ? $("navCards") : $("navLeaderboard")).setAttribute("aria-current", "page");
    const want = cards ? "#cards" : "";
    if (location.hash !== want) history.replaceState(null, "", want || location.pathname);
}

const [response, account, achievements] = await Promise.all(["/api/leaderboard", "/api/me", "/api/me/achievements"].map(url => fetch(url)));
if (!response.ok) {
    $("boardMessage").textContent = response.status === 401 ? "Sign in to see the leaderboard." : "Couldn't load the leaderboard. Try again.";
    $("boardMessage").hidden = false;
    $("boardPage").classList.add("board-failed"); // Nothing to show under the tabs
} else {
    const { players, total, me, cards } = await response.json();
    $("playerBoard").replaceChildren(...(players.length ? players.map(player => playerRow(player, player.id === me?.id)) : [empty("Nobody has a bingo yet.")]));
    // Not in the top 50: your place goes underneath
    if (me && !players.some(player => player.id === me.id)) {
        $("myPlace").replaceChildren(playerRow(me, true));
        $("myPlace").hidden = false;
    }
    $("podium").replaceChildren(...players.slice(0, 3).map(player => podiumSpot(player, player.id === me?.id)));
    $("podium").hidden = !players.length;
    $("playerCount").textContent = `${total} with a bingo`;
    $("statRank").textContent = me ? `#${me.rank}` : "–";
    $("statRankNote").textContent = me ? `of ${total} players` : "Get a bingo to place";
    $("cardBoard").replaceChildren(...(cards.length ? cards.map((card, i) => cardRow(card, i + 1)) : [empty("No cards yet.")]));
}
if (account.ok) {
    const { wins, coins = 0 } = await account.json();
    $("statWins").textContent = wins;
    $("statCoins").textContent = coins.toLocaleString();
    $("coins").textContent = `🪙 ${coins.toLocaleString()} coins`;
}
if (achievements.ok) showAchievements(await achievements.json());

// The top three, with first in the middle and raised
function podiumSpot(player, isMe) {
    const spot = el("li", `podium-spot${isMe ? " me" : ""}`);
    spot.append(el("span", `podium-rank board-rank ${["gold", "silver", "bronze"][player.rank - 1] ?? ""}`, `#${player.rank}`),
        Object.assign(el("img", "avatar podium-avatar"), { src: player.avatar, alt: "" }),
        el("strong", "podium-name", player.name), el("span", "podium-tag", isMe ? "You" : player.rank === 1 ? "Top of the board" : ""),
        el("span", "podium-score", player.wins === 1 ? "🏆 1 bingo" : `🏆 ${player.wins} bingos`));
    return spot;
}

// The five achievements nearest to done, then ones already earned if there's room
function showAchievements(list) {
    const earned = list.filter(a => a.earnedAt).length;
    $("statAchievements").textContent = `${earned}/${list.length}`;
    $("achievementCount").textContent = `${earned} of ${list.length} earned`;
    const closeness = a => a.earnedAt ? -1 : a.progress ? a.progress[0] / a.progress[1] : 0;
    $("milestones").replaceChildren(...[...list].sort((a, b) => closeness(b) - closeness(a)).slice(0, 5).map(a => {
        const item = el("li", `milestone${a.earnedAt ? " done" : ""}`);
        const words = el("span", "milestone-words");
        words.append(el("strong", "", a.name), el("span", "", a.description));
        const count = a.earnedAt ? "Done" : a.progress ? `${a.progress[0]}/${a.progress[1]}` : "";
        item.append(el("span", "milestone-medal", a.earnedAt ? "🏆" : "🔒"), words, el("span", "milestone-count", count));
        if (a.coins) item.append(el("span", "milestone-coins", `+${a.coins} 🪙`));
        if (a.earnedAt || a.progress) {
            const bar = el("span", "milestone-bar");
            bar.style.setProperty("--done", `${a.earnedAt ? 100 : Math.round(a.progress[0] / a.progress[1] * 100)}%`);
            item.append(bar);
        }
        return item;
    }));
}

function empty(text) {
    return el("li", "item empty", text);
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}
