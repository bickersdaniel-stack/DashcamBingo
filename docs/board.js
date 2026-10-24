// Leaderboard rows, shared by the leaderboard page and the room's Leaderboard tile
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
        Object.assign(el("img", "avatar"), { src: player.avatar, alt: "" }),
        el("span", "item-text", isMe ? `${player.name} (you)` : player.name),
        el("span", "board-score", player.wins === 1 ? "🏆 1 bingo" : `🏆 ${player.wins} bingos`)
    );
    return row;
}

export function cardRow(card, place) {
    const row = el("li", "item board-row");
    const words = el("span", "item-text");
    words.append(el("span", "board-card", card.text), el("span", "item-by", card.pack));
    const stat = el("span", "board-score", card.rate === null ? "Not enough games yet" : `Spotted ${card.rate}%`);
    stat.title = `Counted ${card.counted} time${card.counted === 1 ? "" : "s"} in total, dealt ${card.dealt} time${card.dealt === 1 ? "" : "s"}`;
    row.append(el("span", `board-rank ${card.rate === null ? "" : medals[place] ?? ""}`, card.rate === null ? "–" : `#${place}`), words);
    if (card.rare) row.append(el("span", "user-tag tag-rare", "Rare sighting"));
    if (card.rate !== null) {
        const bar = el("span", "board-bar");
        bar.style.setProperty("--rate", `${card.rate}%`);
        row.append(bar);
    }
    row.append(stat);
    return row;
}
