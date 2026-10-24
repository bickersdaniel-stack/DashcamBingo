// Leaderboard page: the players with the most bingos, and the cards spotted most often
import { cardRow, playerRow } from "./board.js";

const $ = id => document.getElementById(id);

document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(other => {
        other.setAttribute("aria-selected", other === tab);
        $(other.getAttribute("aria-controls")).hidden = other !== tab;
    });
}));

const response = await fetch("/api/leaderboard");
if (!response.ok) {
    $("boardMessage").textContent = response.status === 401 ? "Sign in to see the leaderboard." : "Couldn't load the leaderboard. Try again.";
    $("boardMessage").hidden = false;
} else {
    const { players, me, cards } = await response.json();
    $("playerBoard").replaceChildren(...(players.length ? players.map(player => playerRow(player, player.id === me?.id)) : [empty("Nobody has a bingo yet.")]));
    // Not in the top 50: your place goes underneath
    if (me && !players.some(player => player.id === me.id)) {
        $("myPlace").replaceChildren(playerRow(me, true));
        $("myPlace").hidden = false;
    }
    $("cardBoard").replaceChildren(...(cards.length ? cards.map((card, i) => cardRow(card, i + 1)) : [empty("No cards yet.")]));
}

function empty(text) {
    return Object.assign(document.createElement("li"), { className: "item empty", textContent: text });
}
