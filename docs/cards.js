// Cards page: every square with the skins you've collected for it, to search, filter and sort, and each one up close
// with its details and every skin: the ones you own to wear, the rest to preview and buy
import { fillPlayCard } from "./playcard.js";
import { coinsText, showNewSkins } from "./nav.js";

const $ = id => document.getElementById(id);
const rarityOrder = ["common", "rare", "epic", "legendary"];
const byName = (a, b) => a.text.localeCompare(b.text);
const sorts = {
    name: byName,
    skins: (a, b) => b.owned.length - a.owned.length || byName(a, b),
    spotted: (a, b) => (b.rate ?? -1) - (a.rate ?? -1) || byName(a, b),
    rare: (a, b) => (a.rate ?? 101) - (b.rate ?? 101) || byName(a, b) // New cards, with no rate yet, go last
};
let cards = [];   // Your collection, with each card's spotted rate added
let styles = [];  // Every skin there is
let open = null;  // The card in the dialog
let buying = null; // The skin being previewed, which you don't own
let prices = {};  // What a skin of each rarity costs to buy
let coins = 0;

const [collection, all, shop] = await Promise.all(["/api/me/collection", "/api/cards", "/api/shop"].map(url => api("GET", url)));
if (!collection.ok) {
    $("cardsMessage").textContent = collection.status === 401 ? "Sign in to see your cards." : collection.data.error;
    $("cardsMessage").hidden = false;
    $("cardFilters").hidden = true;
} else {
    const rates = new Map((all.ok ? all.data.cards : []).map(card => [card.id, card.rate]));
    cards = collection.data.map(card => ({ ...card, rate: rates.get(card.id) ?? null }));
    if (shop.ok) {
        styles = [...shop.data.styles].sort((a, b) => rarityOrder.indexOf(a.rarity) - rarityOrder.indexOf(b.rarity));
        prices = Object.fromEntries(shop.data.rarities.map(r => [r.id, r.price]));
        coins = shop.data.coins;
    }
    $("cardPack").append(...[...new Set(cards.map(card => card.packName))].sort().map(name => new Option(name, name)));
    for (const id of ["cardSearch", "cardPack", "cardOwned", "cardRarity", "cardSort"]) $(id).addEventListener("input", showCards);
    $("showcaseButton").addEventListener("click", showcase);
    $("buyButton").addEventListener("click", buy);
    showCards();
    // Seen now: the "(+3)" goes, and the new ones stay on top until you leave the page
    showNewSkins(0);
    api("POST", "/api/me/skins/seen");
}

function showCards() {
    const search = $("cardSearch").value.trim().toLowerCase();
    const [pack, owned, rarity] = ["cardPack", "cardOwned", "cardRarity"].map(id => $(id).value);
    const shown = cards.filter(card => card.text.toLowerCase().includes(search)
        && (!pack || card.packName === pack)
        && (!owned || (owned === "owned" ? card.owned.length > 0 : owned === "none" ? !card.owned.length : !!card.equipped))
        && (!rarity || card.owned.some(skin => skin.rarity === rarity)))
        .sort((a, b) => b.new - a.new || sorts[$("cardSort").value](a, b)); // New skins first
    const skins = cards.reduce((sum, card) => sum + card.owned.length, 0);
    $("cardCount").textContent = `${shown.length} of ${cards.length} cards · ${skins} skin${skins === 1 ? "" : "s"} collected`;
    $("collection").replaceChildren(...(shown.length ? shown.map(tile) : [el("p", "admin-hint", "No cards match.")]));
}

function tile(card) {
    const item = Object.assign(el("button", "collection-item"), { type: "button", ariaLabel: `${card.text}: details and skins` });
    const wearing = worn(card);
    const head = el("div", "collection-head");
    head.append(wearing ? el("span", `rarity-tag rarity-${wearing.rarity}`, wearing.rarity) : el("span", "rarity-tag", card.owned.length ? "No skin on" : "No skins"),
        ...(card.new ? [el("span", "new-tag", "New")] : []),
        el("span", "collection-owned", styles.length ? `${card.owned.length}/${styles.length}` : `${card.owned.length} owned`));
    const face = el("div", "play-card mini");
    fillPlayCard(face, playCardOf(card, wearing));
    item.append(head, face);
    item.addEventListener("click", () => {
        open = card;
        showDetail();
        $("cardDialog").showModal();
    });
    return item;
}

// The open card, wearing its skin or the one being previewed
function showDetail(preview = null) {
    const card = open;
    fillPlayCard($("detailCard"), playCardOf(card, preview ?? worn(card)));
    $("detailName").textContent = card.text;
    $("detailMeta").textContent = `${card.packName} · ${card.rate === null ? "New card, not enough games yet" : `Spotted in ${card.rate}% of the games it's dealt in`}`;
    const ownedIds = new Set(card.owned.map(skin => skin.id));
    $("skinCount").textContent = `Skins ${card.owned.length}/${styles.length}`;
    $("skinChoices").replaceChildren(skinChoice("No skin", null, card.owned.length > 0),
        ...styles.map(style => skinChoice(style.name, style.id, ownedIds.has(style.id), style)));
    buying = preview && !ownedIds.has(preview.id) ? preview : null;
    $("skinHint").textContent = buying ? `Previewing ${buying.name} (${buying.rarity}). You don't have it for this card yet.` : "";
    $("buyButton").hidden = !buying;
    if (buying) {
        $("buyButton").textContent = `Buy for ${prices[buying.rarity]} 🪙`;
        $("buyButton").disabled = coins < prices[buying.rarity];
        if (coins < prices[buying.rarity]) $("skinHint").append(` You have ${coins.toLocaleString()} coins.`);
    }
    $("showcaseButton").setAttribute("aria-pressed", card.showcased);
    $("showcaseButton").textContent = card.showcased ? "✓ Showcased on your profile" : "Showcase on your profile";
}

async function buy() {
    const result = await api("POST", "/api/shop/buy", { cardId: open.id, style: buying.id });
    if (!result.ok) return $("skinHint").textContent = result.data.error;
    const { skin, equipped, achievements } = result.data;
    coins = result.data.coins;
    document.querySelectorAll(".my-coins").forEach(node => node.textContent = coinsText(coins)); // The bar and the menu
    open.owned.push(skin);
    open.equipped = equipped;
    showDetail(equipped === skin.id ? null : skin); // Still showing the skin you bought
    $("skinHint").textContent = [`${skin.name} is yours.`, ...achievements.map(a => `🏆 ${a.name} unlocked${a.coins ? ` · +${a.coins} 🪙` : ""}`)].join(" ");
    showCards();
}

// Everyone who opens your profile sees this card, in the skin it's wearing; pressing it again takes it off
async function showcase() {
    const result = await api("POST", "/api/me/showcase", { cardId: open.showcased ? null : open.id });
    if (!result.ok) return $("skinHint").textContent = result.data.error;
    const on = !open.showcased;
    cards.forEach(card => card.showcased = on && card === open);
    showDetail();
}

// Owned skins put on when picked; the rest only preview on the card
function skinChoice(label, styleId, owned, style = null) {
    const locked = style && !owned;
    const button = el("button", `skin-choice${style ? ` rarity-${style.rarity}` : ""}${locked ? " locked" : ""}`, locked ? `🔒 ${label}` : label);
    button.type = "button";
    button.setAttribute("aria-pressed", (open.equipped ?? null) === styleId);
    button.disabled = !style && !owned; // "No skin" on a card with no skins is already the case
    button.addEventListener("click", async () => {
        if (locked) return showDetail(style);
        const result = await api("POST", "/api/me/skins/equip", { cardId: open.id, style: styleId });
        if (!result.ok) return $("skinHint").textContent = result.data.error;
        open.equipped = styleId;
        showDetail();
        showCards();
    });
    return button;
}

function worn(card) {
    return card.owned.find(skin => skin.id === card.equipped) ?? null;
}

function playCardOf(card, skin) {
    return { name: card.text, note: card.description, packId: card.pack, packName: card.packName, rate: card.rate, skin };
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
