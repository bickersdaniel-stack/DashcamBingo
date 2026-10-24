// Shop page: roll for card skins with coins from playing, watch the card flip, and choose which skins to wear
import { fillPlayCard } from "./playcard.js";

const $ = id => document.getElementById(id);
let shop = null;
let collection = [];
let rolling = false;

$("rollButton").addEventListener("click", roll);
$("collectionFilter").addEventListener("input", showCollection);

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
    await loadCollection();
}

function showCoins() {
    $("coins").textContent = `🪙 ${shop.coins.toLocaleString()} coins`;
    $("rollButton").textContent = `Roll · ${shop.cost} 🪙`;
    $("rollButton").disabled = rolling || shop.coins < shop.cost;
    $("rollButton").title = shop.coins < shop.cost ? `You need ${shop.cost} coins. Earn them by spotting squares, getting bingo and unlocking achievements.` : "";
    const left = shop.pityAfter - shop.pity;
    $("pity").textContent = left <= 0 ? "Your next roll is an epic or better." : `An epic or better is guaranteed within ${left} roll${left === 1 ? "" : "s"}.`;
}

async function roll() {
    if (rolling) return;
    rolling = true;
    showCoins();
    $("rollResult").textContent = "";
    $("revealInner").classList.remove("flipped");
    $("reveal").className = "reveal rolling";
    const [result] = await Promise.all([api("POST", "/api/shop/roll"), new Promise(r => setTimeout(r, 900))]); // Let it shake a moment
    rolling = false;
    if (!result.ok) {
        $("reveal").className = "reveal";
        message(result.data.error);
        return showCoins();
    }
    const { card, skin, duplicate, refund, coins, pity, achievements } = result.data;
    Object.assign(shop, { coins, pity });
    fillPlayCard($("revealFront"), { name: card.text, note: card.description, packId: card.pack, packName: packName(card.pack), skin });
    $("revealFront").classList.add("reveal-face", "reveal-front");
    $("reveal").className = `reveal rarity-${skin.rarity}${skin.rarity === "legendary" ? " burst" : ""}`;
    $("revealInner").classList.add("flipped");
    $("rollResult").textContent = `${skin.name} ${card.text}, ${skin.rarity}.` + (duplicate ? ` You already had it, so ${refund} coins came back.` : "")
        + achievements.map(a => ` Achievement unlocked: ${a.name}${a.coins ? ` (+${a.coins} coins)` : ""}!`).join("");
    showCoins();
    await loadCollection();
}

async function loadCollection() {
    const { ok, data } = await api("GET", "/api/me/collection");
    if (!ok) return;
    collection = data;
    showCollection();
}

const packName = id => collection.find(card => card.pack === id)?.packName ?? "";

function showCollection() {
    const filter = $("collectionFilter").value;
    const shown = collection.filter(card => filter === "all" || (filter === "owned" ? card.owned.length : card.owned.some(skin => skin.rarity === filter)));
    const skins = collection.reduce((sum, card) => sum + card.owned.length, 0);
    const cards = collection.filter(card => card.owned.length).length;
    $("collectionCount").textContent = `${skins} skin${skins === 1 ? "" : "s"} across ${cards} card${cards === 1 ? "" : "s"}`;
    if (!shown.length) {
        return $("collection").replaceChildren(el("p", "admin-hint", filter === "owned" ? "No skins yet. Roll above to get your first." : "Nothing here yet."));
    }
    $("collection").replaceChildren(...shown.map(card => {
        const item = el("div", "collection-item");
        const face = el("div", "play-card mini");
        const wearing = card.owned.find(skin => skin.id === card.equipped) ?? null;
        fillPlayCard(face, { name: card.text, note: card.description, packId: card.pack, packName: card.packName, skin: wearing });
        item.append(face);
        if (card.owned.length) {
            const choose = el("select", "quality-select");
            choose.ariaLabel = `Skin for ${card.text}`;
            choose.append(new Option("No skin", ""), ...card.owned.map(skin => new Option(`${skin.name} (${skin.rarity})`, skin.id)));
            choose.value = card.equipped ?? "";
            choose.addEventListener("change", async () => {
                const result = await api("POST", "/api/me/skins/equip", { cardId: card.id, style: choose.value || null });
                if (!result.ok) return message(result.data.error);
                card.equipped = choose.value || null;
                showCollection();
            });
            item.append(choose);
        }
        return item;
    }));
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
