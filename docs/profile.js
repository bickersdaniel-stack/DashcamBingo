// A player's profile pop-up, opened from their name anywhere it shows: wins and place, the card they show off,
// and the achievements they've earned
import { fillPlayCard } from "./playcard.js";

let dialog = null;

function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

// A player's picture, in the frame they wear
export function avatarOf(player, className = "avatar") {
    return Object.assign(el("img", player.frame ? `${className} frame-${player.frame}` : className), { src: player.avatar, alt: "" });
}

// A name, with their title under it, that opens its player's profile
export function profileLink(player, className, text = player.name) {
    const button = el("button", `${className} profile-link`, text);
    if (player.title) button.append(el("small", "player-title", player.title));
    button.type = "button";
    button.addEventListener("click", event => {
        event.stopPropagation();
        openProfile(player.id);
    });
    return button;
}

export async function openProfile(id) {
    dialog ??= makeDialog();
    const response = await fetch(`/api/players/${encodeURIComponent(id)}`);
    const data = await response.json().catch(() => ({ error: "Something went wrong. Try again." }));
    const part = name => dialog.querySelector(`.profile-${name}`);
    part("error").textContent = response.ok ? "" : data.error;
    part("error").hidden = response.ok;
    part("body").hidden = !response.ok;
    if (response.ok) {
        part("avatar").replaceWith(avatarOf(data, "avatar profile-avatar"));
        part("name").textContent = data.name; // textContent: names are untrusted
        part("title").textContent = data.title ?? "";
        part("title").hidden = !data.title;
        part("banner").className = `profile-banner${data.banner ? ` banner-${data.banner}` : ""}`;
        part("banner").hidden = !data.banner;
        part("stats").textContent = [data.wins === 1 ? "🏆 1 bingo" : `🏆 ${data.wins} bingos`,
            ...(data.rank ? [`#${data.rank} on the leaderboard`] : []), `${data.skins} skin${data.skins === 1 ? "" : "s"}`].join(" · ");
        if (data.showcase) {
            const { text, description, pack, packName, skin } = data.showcase;
            fillPlayCard(part("showcase"), { name: text, note: description, packId: pack, packName, skin });
        }
        part("showcase").hidden = !data.showcase;
        part("no-showcase").hidden = !!data.showcase;
        part("earned").textContent = `Achievements · ${data.achievements.length} of ${data.achievementTotal}`;
        part("achievements").replaceChildren(...(data.achievements.length ? data.achievements.map(a => {
            const item = el("li", "item achievement earned");
            const words = el("span", "item-text");
            words.append(el("strong", "", a.name), el("span", "", a.description));
            item.append(el("span", "achievement-medal", "🏆"), words);
            return item;
        }) : [el("li", "item empty", "None yet.")]));
    }
    if (!dialog.open) dialog.showModal();
}

function makeDialog() {
    const node = el("dialog", "panel-dialog profile-dialog");
    node.setAttribute("aria-label", "Player profile");
    node.innerHTML = `
        <p class="email-message error profile-error" role="status" hidden></p>
        <div class="profile-body">
            <div class="profile-banner" hidden></div>
            <div class="profile-head">
                <img class="avatar profile-avatar" alt="">
                <div>
                    <h2 class="profile-name"></h2>
                    <p class="player-title profile-title" hidden></p>
                    <p class="admin-hint profile-stats"></p>
                </div>
            </div>
            <p class="menu-label">Showcase</p>
            <div class="play-card profile-showcase"></div>
            <p class="admin-hint profile-no-showcase">Nothing showcased yet.</p>
            <p class="menu-label profile-earned"></p>
            <ul class="item-list achievement-list profile-achievements"></ul>
        </div>
        <form class="dialog-close" method="dialog"><button class="btn btn-quiet" type="submit">Close</button></form>`;
    document.body.append(node);
    return node;
}
