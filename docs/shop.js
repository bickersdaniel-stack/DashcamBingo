// Shop page: roll for card skins with coins from playing and watch the card flip (wearing them is on the Cards page),
// and buy and wear extras
import { fillPlayCard } from "./playcard.js";
import { coinsText, showNewSkins } from "./nav.js";

const $ = id => document.getElementById(id);
let shop = null;
let rolling = false;
const kinds = { frame: "Frames", title: "Titles", banner: "Banners" };

$("rollButton").addEventListener("click", roll);

const loaded = await api("GET", "/api/shop");
if (!loaded.ok) {
    message(loaded.status === 401 ? "Sign in to use the shop." : loaded.data.error);
    $("rollSection").hidden = true;
} else {
    shop = loaded.data;
    $("odds").replaceChildren(...shop.rarities.map(r => {
        const item = el("li", `shop-odd rarity-${r.id}`);
        item.append(el("span", "play-card-gem"), el("span", "", r.name), el("span", "shop-chance", `${r.chance}%`));
        return item;
    }));
    showCoins();
}

function showCoins() {
    if (shop.extras) showExtras(); // What you can afford changes with your coins
    document.querySelectorAll(".my-coins").forEach(el => el.textContent = coinsText(shop.coins)); // The bar and the menu
    $("rollButton").textContent = rolling ? "Rolling…" : `${$("rollResult").hasChildNodes() ? "Roll again" : "Roll"} · ${shop.cost} 🪙`;
    $("rollButton").disabled = rolling || shop.coins < shop.cost;
    // Said out loud rather than in a tooltip, which phones never show
    $("rollNote").textContent = `You need ${shop.cost} coins. Earn them by spotting squares, getting bingo and unlocking achievements.`;
    $("rollNote").hidden = rolling || shop.coins >= shop.cost;
    const left = shop.pityAfter - shop.pity;
    $("pity").textContent = left <= 0 ? "Your next roll is epic or better" : `Epic or better within ${left} roll${left === 1 ? "" : "s"}`;
    $("pityCount").textContent = `${Math.min(shop.pity, shop.pityAfter)} / ${shop.pityAfter}`;
    $("pityBar").style.setProperty("--done", `${Math.min(shop.pity / shop.pityAfter, 1) * 100}%`);
}

async function roll() {
    if (rolling) return;
    rolling = true;
    $("rollResult").replaceChildren();
    showCoins();
    $("revealInner").classList.remove("flipped");
    $("reveal").className = "reveal rolling";
    const [result] = await Promise.all([api("POST", "/api/shop/roll"), new Promise(r => setTimeout(r, 1100))]); // At least one sweep of the loading shimmer
    rolling = false;
    if (!result.ok) {
        $("reveal").className = "reveal";
        $("rollResult").replaceChildren(el("p", "email-message error", result.data.error)); // Next to the button, not up top
        return showCoins();
    }
    const { card, skin, duplicate, worn, refund, coins, pity, newSkins, achievements } = result.data;
    showNewSkins(newSkins);
    Object.assign(shop, { coins, pity });
    fillPlayCard($("revealFront"), { name: card.text, note: card.description, packId: card.pack, packName: card.packName, skin });
    $("revealFront").classList.add("reveal-face", "reveal-front");
    $("reveal").className = `reveal rarity-${skin.rarity}${skin.rarity === "legendary" ? " burst" : ""}`;
    $("revealInner").classList.add("flipped");
    const line = el("p", "roll-line");
    line.append(el("span", `rarity-tag rarity-${skin.rarity}`, skin.rarity), el("strong", "", skin.name), ` for “${card.text}”`);
    // A card's first skin (or one rolled while it wears none) goes straight on
    const note = el("p", "admin-hint", duplicate ? `You already had it, so ${refund} coins came back. ` : worn ? "It's on that square now. " : "");
    note.append(Object.assign(el("a", "", worn || duplicate ? "See your cards" : "Wear it from the Cards page"), { href: "/cards" }));
    $("rollResult").replaceChildren(line, note,
        ...achievements.map(a => el("p", "roll-achievement", `🏆 ${a.name} unlocked${a.coins ? ` · +${a.coins} 🪙` : ""}`)));
    showCoins();
}

function showExtras() {
    $("extras").replaceChildren(...Object.entries(kinds).map(([kind, label]) => {
        const list = el("div", "extra-list");
        list.append(...shop.extras.filter(extra => extra.kind === kind).map(extraItem));
        const group = el("div", "extra-group");
        group.append(el("p", "menu-label", label), list);
        return group;
    }));
}

// What it looks like, its name, and Buy, Wear, or (pressed) Wearing to take it off
function extraItem(extra) {
    const owned = shop.owned.includes(extra.id);
    const wearing = shop.wearing[extra.kind] === extra.id;
    const item = el("div", `extra${wearing ? " wearing" : ""}`);
    if (extra.kind === "frame") item.append(Object.assign(el("img", `avatar extra-avatar frame-${extra.id}`), { src: shop.avatar, alt: "" }));
    if (extra.kind === "banner") item.append(el("span", `extra-banner banner-${extra.id}`));
    item.append(el("strong", extra.kind === "title" ? "extra-name player-title" : "extra-name", extra.name));
    const button = el("button", `btn ${owned ? "btn-quiet" : "btn-primary"} extra-button`, wearing ? "✓ Wearing" : owned ? "Wear" : `${extra.price} 🪙`);
    button.type = "button";
    if (owned) button.setAttribute("aria-pressed", wearing);
    else button.disabled = shop.coins < extra.price;
    button.ariaLabel = `${wearing ? "Take off" : owned ? "Wear" : `Buy for ${extra.price} coins:`} ${extra.name}`;
    button.addEventListener("click", () => owned ? wear(extra.kind, wearing ? null : extra.id) : buyExtra(extra.id));
    item.append(button);
    return item;
}

async function buyExtra(id) {
    const result = await api("POST", "/api/shop/extras/buy", { id });
    showExtrasError(result);
    if (result.ok) Object.assign(shop, result.data); // coins, owned, wearing
    showCoins();
}

async function wear(kind, id) {
    const result = await api("POST", "/api/me/wear", { kind, id });
    showExtrasError(result);
    if (result.ok) shop.wearing = result.data.wearing;
    showExtras();
}

function showExtrasError(result) {
    $("extrasMessage").textContent = result.ok ? "" : result.data.error;
    $("extrasMessage").hidden = result.ok;
}

function message(text) {
    $("shopMessage").textContent = text;
    $("shopMessage").hidden = !text;
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

async function api(method, url, body) {
    const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({ error: "Something went wrong. Try again." }));
    return { ok: response.ok, status: response.status, data };
}
