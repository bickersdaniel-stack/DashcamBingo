// A player's profile pop-up, opened from their name anywhere it shows: their banner and picture, wins, place and
// skins, then the card they show off and the achievements they've earned
import { fillPlayCard } from "./playcard.js";

let dialog = null;
const icon = path => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;

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
        part("banner").className = `profile-banner${data.banner ? ` banner-${data.banner}` : ""}`; // Our logo when they wear none
        part("avatar").replaceWith(avatarOf(data, "avatar profile-avatar"));
        part("wins").textContent = data.wins;
        part("rank").textContent = data.rank ? `#${data.rank}` : "–";
        part("skins").textContent = data.skins;
        part("action").hidden = !data.mine;
        part("name").textContent = data.name; // textContent: names are untrusted
        part("title").hidden = !data.title;
        part("title-text").textContent = data.title ?? "";
        part("earned").textContent = `${data.achievements.length} of ${data.achievementTotal} achievements`;
        if (data.showcase) {
            const { text, description, pack, packName, skin } = data.showcase;
            fillPlayCard(part("showcase"), { name: text, note: description, packId: pack, packName, skin });
            part("card-name").textContent = text;
            part("card-pack").textContent = `${packName} pack`;
            part("card-skin").replaceChildren(skin ? el("span", `rarity-tag rarity-${skin.rarity}`, skin.rarity) : "", skin ? ` ${skin.name}` : "No skin on");
        }
        part("showcase-row").hidden = !data.showcase;
        part("no-showcase").hidden = !!data.showcase;
        part("achievements").replaceChildren(...(data.achievements.length
            ? data.achievements.map(a => Object.assign(el("li", "", a.name), { title: a.description }))
            : [el("li", "profile-none", "None yet.")]));
    }
    if (!dialog.open) dialog.showModal();
}

function makeDialog() {
    const node = el("dialog", "panel-dialog profile-dialog");
    node.setAttribute("aria-label", "Player profile");
    node.innerHTML = `
        <p class="email-message error profile-error" role="status" hidden></p>
        <div class="profile-body">
            <div class="profile-banner"><svg class="logo-mark" aria-hidden="true"><use href="/icons/logo-mark.svg#mark-small"/></svg></div>
            <div class="profile-top">
                <img class="avatar profile-avatar" alt="">
                <p class="profile-stats">
                    <span><strong class="profile-wins"></strong>Bingos</span>
                    <span><strong class="profile-rank"></strong>Place</span>
                    <span><strong class="profile-skins"></strong>Skins</span>
                </p>
                <a class="btn btn-primary profile-action" href="/shop" hidden>Change look</a>
            </div>
            <h2 class="profile-name"></h2>
            <p class="profile-meta">
                <span class="profile-title">${icon("M7 7h.01M7 3h5a2 2 0 011.41.59l7 7a2 2 0 010 2.82l-7 7a2 2 0 01-2.82 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z")}<span class="profile-title-text"></span></span>
                <span>${icon("M12 15a6 6 0 100-12 6 6 0 000 12zm0 0l-4 6 1.5-4.5L5 15m7 0l4 6-1.5-4.5L19 15")}<span class="profile-earned"></span></span>
            </p>
            <section class="profile-section">
                <h3 class="profile-heading">Showcase</h3>
                <div class="profile-showcase-row">
                    <div class="play-card mini profile-showcase"></div>
                    <div class="profile-facts">
                        <strong class="profile-card-name"></strong>
                        <span class="profile-card-pack"></span>
                        <span class="profile-card-skin"></span>
                    </div>
                </div>
                <p class="profile-none profile-no-showcase">Nothing showcased yet.</p>
            </section>
            <section class="profile-section">
                <h3 class="profile-heading">Achievements</h3>
                <ul class="profile-achievements"></ul>
            </section>
        </div>
        <form class="dialog-close" method="dialog"><button class="btn btn-quiet" type="submit">Close</button></form>`;
    document.body.append(node);
    return node;
}
