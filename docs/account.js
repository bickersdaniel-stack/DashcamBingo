// Your coins and picture on the right of the top bar, for the pages around the game (leaderboard, cards, shop,
// admin). The picture opens the same menu as in the lobby, without the lobby's suggestion and achievement dialogs
import { coinsText, showNewSkins, signedInWith, winsText } from "./nav.js";
import { openProfile } from "./profile.js";

const $ = id => document.getElementById(id);
const icon = path => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
const menu = `
    <div class="account-menu" id="account">
        <button class="account-button" id="accountButton" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="accountPanel">
            <img class="avatar my-avatar" alt="">
            <span class="account-name my-name"></span>
            ${icon("M19 9l-7 7-7-7")}
        </button>
        <div class="account-panel" id="accountPanel" hidden>
            <div class="account-head">
                <img class="avatar my-avatar" alt="">
                <div>
                    <strong class="my-name"></strong>
                    <span class="my-wins"></span>
                    <span class="my-coins"></span>
                    <span class="my-via"></span>
                </div>
            </div>
            <p class="menu-label">Theme</p>
            <button id="themeButton" class="pill theme-button" type="button" title="Switch between System, Light and Dark"></button>
            <p class="menu-label">Colour for marked squares</p>
            <div class="swatches" id="presetSwatches"></div>
            <div id="recentSection" hidden>
                <p class="menu-label">Recent</p>
                <div class="swatches" id="recentSwatches"></div>
            </div>
            <label class="custom-colour">
                <input type="color" id="colorPicker" value="#22c55e">
                ${icon("M12 4v16m8-8H4")}
                Custom colour
            </label>
            <div class="menu-actions">
                <button class="menu-item" id="profileButton" type="button">
                    ${icon("M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z")}
                    My profile
                </button>
                <a class="menu-item" id="manageLink" href="/admin" hidden>
                    ${icon("M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z")}
                    <span id="manageLabel">Manage cards</span>
                </a>
                <form method="post" action="/auth/logout">
                    <button class="menu-item" type="submit">
                        ${icon("M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1")}
                        Sign out
                    </button>
                </form>
            </div>
        </div>
    </div>`;

// Not awaited, so the page's own script doesn't wait for it
showAccount();

async function showAccount() {
    const response = await fetch("/api/me");
    if (!response.ok) return;
    const me = await response.json();
    document.querySelector(".top-bar > .bar-side:last-child").insertAdjacentHTML("beforeend", menu);
    await import("./core.js"); // The theme and colour controls; it finds the menu's elements as it loads
    document.querySelectorAll(".my-avatar").forEach(img => img.src = me.avatar);
    document.querySelectorAll(".my-name").forEach(el => el.textContent = me.name); // textContent: names are untrusted
    document.querySelectorAll(".my-wins").forEach(el => el.textContent = winsText(me.wins));
    document.querySelectorAll(".my-coins").forEach(el => el.textContent = coinsText(me.coins ?? 0));
    document.querySelector(".my-via").textContent = signedInWith(me.id);
    // The Cards page clears its own count once it has shown the new skins
    if (!document.querySelector('.bar-nav a[href="/cards"][aria-current="page"]')) showNewSkins(me.newSkins);

    const setOpen = open => {
        $("accountPanel").hidden = !open;
        $("accountButton").setAttribute("aria-expanded", open);
    };
    $("accountButton").addEventListener("click", () => setOpen($("accountPanel").hidden));
    $("profileButton").addEventListener("click", () => {
        setOpen(false);
        openProfile(me.id);
    });
    // The path, not the target: the theme button redraws itself, so its clicked icon is gone by now
    document.addEventListener("click", event => event.composedPath().includes($("account")) || setOpen(false));
    document.addEventListener("keydown", event => event.key === "Escape" && setOpen(false));

    if (!me.admin) return;
    $("manageLink").hidden = false;
    const { pending } = await fetch("/api/admin/suggestions").then(r => r.json()).catch(() => ({}));
    if (pending?.length) $("manageLabel").textContent = `Manage cards (${pending.length} waiting)`;
}
