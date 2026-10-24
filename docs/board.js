// Leaderboard rows, shared by the leaderboard page and the room's Leaderboard tile
import { avatarOf, profileLink } from "./profile.js";

const medals = { 1: "gold", 2: "silver", 3: "bronze" };

function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export function playerRow(player, isMe = false) {
    const row = el("li", `item board-row${isMe ? " me" : ""}`);
    row.append(
        el("span", `board-rank ${medals[player.rank] ?? ""}`, `#${player.rank}`),
        avatarOf(player),
        profileLink(player, "item-text", isMe ? `${player.name} (you)` : player.name),
        el("span", "board-score", player.wins === 1 ? "🏆 1 bingo" : `🏆 ${player.wins} bingos`)
    );
    return row;
}

export function cardRow(card, place) {
    const row = el("li", "item board-row");
    const words = el("span", "item-text");
    words.append(el("span", "board-card", card.text), el("span", "item-by", card.pack));
    const counted = card.counted ?? 0;
    const stat = el("span", "board-score", card.rate === null
        ? (counted === 1 ? "Counted 1" : `Counted ${counted}`)
        : `Counted ${counted} · ${card.rate}%`);
    stat.title = `Counted ${counted} time${counted === 1 ? "" : "s"} in total, marked on ${card.spotted ?? 0} of ${card.dealt} deals`;
    row.append(el("span", `board-rank ${counted ? medals[place] ?? "" : ""}`, counted ? `#${place}` : "–"), words);
    if (card.rare) row.append(el("span", "user-tag tag-rare", "Rare sighting"));
    if (card.rate !== null) {
        const bar = el("span", "board-bar");
        bar.style.setProperty("--rate", `${card.rate}%`);
        row.append(bar);
    }
    row.append(stat);
    return row;
}
