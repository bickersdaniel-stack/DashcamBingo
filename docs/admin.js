// Admin page: review suggested squares, edit every card and its description, and sort cards into packs
const $ = id => document.getElementById(id);
let packs = [];
let cards = [];

document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => selectTab(tab)));
["cardSearch", "cardPackFilter", "cardSort"].forEach(id => $(id).addEventListener("input", showCards));

$("newCardForm").addEventListener("submit", async event => {
    event.preventDefault();
    const result = await api("POST", "/api/admin/cards", { text: $("newCardText").value, description: $("newCardDescription").value, pack: $("newCardPack").value });
    if (!done(result, "Card added.")) return;
    $("newCardText").value = $("newCardDescription").value = "";
    load();
});

$("newPackForm").addEventListener("submit", async event => {
    event.preventDefault();
    const result = await api("POST", "/api/admin/packs", { name: $("newPackName").value, description: $("newPackDescription").value, on: $("newPackOn").checked });
    if (!done(result, "Pack added.")) return;
    $("newPackName").value = $("newPackDescription").value = "";
    $("newPackOn").checked = false;
    load();
});

async function load() {
    const [all, waiting] = await Promise.all([api("GET", "/api/admin/cards"), api("GET", "/api/admin/suggestions")]);
    if (!all.ok) return message(all.data.error, false);
    ({ packs, cards } = all.data);
    fillPackSelect($("newCardPack"), $("newCardPack").value || firstOnPack());
    const filter = $("cardPackFilter").value;
    $("cardPackFilter").replaceChildren(new Option("All packs", "all"), ...packs.map(pack => new Option(pack.name, pack.id)));
    $("cardPackFilter").value = packs.some(pack => pack.id === filter) ? filter : "all";
    showSuggestions(waiting.data.pending ?? []);
    showCards();
    showPacks();
    return waiting.data.pending?.length ?? 0;
}

function showSuggestions(list) {
    $("suggestionsTab").textContent = list.length ? `Suggestions (${list.length})` : "Suggestions";
    $("pendingList").replaceChildren(...(list.length ? list : [null]).map(s => {
        if (!s) return el("li", "item empty", "Nothing waiting. 🎉");
        const item = el("li", "item admin-row");
        const text = input(s.text, 60, "Square wording");
        const description = input(s.description ?? "", 140, "Description (optional)");
        const pack = fillPackSelect(el("select", "quality-select pack-select"), firstOnPack());
        const decide = action => async () => {
            const result = await api("POST", `/api/admin/suggestions/${s.id}`, { action, text: text.value, description: description.value, pack: pack.value });
            if (done(result, action === "approve" ? `Added "${result.data.text}".` : "Rejected.")) load();
        };
        item.append(text, description, pack, el("span", "item-by", `from ${s.by.name}`),
            button("Approve", "btn btn-primary", decide("approve")), button("Reject", "btn btn-quiet", decide("reject")));
        return item;
    }));
}

// How often a card gets marked when it's dealt; under 10 deals the number doesn't mean much yet
const rate = card => card.dealt >= 10 ? card.spotted / card.dealt : null;

function showCards() {
    const search = $("cardSearch").value.trim().toLowerCase();
    const filter = $("cardPackFilter").value;
    const sort = $("cardSort").value;
    const shown = cards
        .filter(card => (filter === "all" || card.pack === filter) && (`${card.text} ${card.description}`).toLowerCase().includes(search))
        .sort((a, b) => {
            if (sort === "az") return a.text.localeCompare(b.text);
            const [ra, rb] = [rate(a), rate(b)];
            if (ra === null || rb === null) return (ra === null) - (rb === null) || a.text.localeCompare(b.text); // Too few games go last
            return sort === "most" ? rb - ra : ra - rb;
        });
    $("cardCount").textContent = `${shown.length} of ${cards.length} cards`;
    $("cardList").replaceChildren(...(shown.length ? shown : [null]).map(card => {
        if (!card) return el("li", "item empty", "No cards match.");
        const item = el("li", "item admin-row");
        const text = input(card.text, 60, "Card wording");
        const description = input(card.description, 140, "Description (optional)");
        const pack = fillPackSelect(el("select", "quality-select pack-select"), card.pack);
        const r = rate(card);
        const stats = el("span", "admin-stats", r === null ? "Not enough games yet" : `Spotted ${Math.round(r * 100)}%`);
        stats.title = `Marked on ${card.spotted} of the ${card.dealt} cards it was dealt on`;
        const save = button("Save", "btn btn-primary", async () => {
            const result = await api("PATCH", `/api/admin/cards/${card.id}`, { text: text.value, description: description.value, pack: pack.value });
            if (done(result, "Saved.")) load();
        });
        const remove = button("Delete", "link-button", async () => {
            if (!confirm(`Delete "${card.text}"? It comes off every new card.`)) return;
            if (done(await api("DELETE", `/api/admin/cards/${card.id}`), "Deleted.")) load();
        });
        showSaveWhenEdited(item, save);
        item.append(text, description, pack, stats);
        if (card.by) item.append(el("span", "item-by", `from ${card.by.name}`));
        item.append(save, remove);
        return item;
    }));
}

function showPacks() {
    $("packList").replaceChildren(...packs.map(pack => {
        const item = el("li", "item admin-row");
        const name = input(pack.name, 30, "Pack name");
        const description = input(pack.description, 140, "Description (optional)");
        const on = Object.assign(document.createElement("input"), { type: "checkbox", checked: pack.on });
        const onLabel = el("label", "check-label");
        onLabel.append(on, " On by default");
        const save = button("Save", "btn btn-primary", async () => {
            const result = await api("PATCH", `/api/admin/packs/${pack.id}`, { name: name.value, description: description.value, on: on.checked });
            if (done(result, "Saved.")) load();
        });
        const remove = button("Delete", "link-button", async () => {
            if (!confirm(`Delete the "${pack.name}" pack?`)) return;
            if (done(await api("DELETE", `/api/admin/packs/${pack.id}`), "Deleted.")) load();
        });
        showSaveWhenEdited(item, save);
        item.append(name, description, onLabel, el("span", "admin-stats", `${pack.count} card${pack.count === 1 ? "" : "s"}`), save, remove);
        return item;
    }));
}

function selectTab(tab) {
    document.querySelectorAll(".tab").forEach(other => {
        other.setAttribute("aria-selected", other === tab);
        $(other.getAttribute("aria-controls")).hidden = other !== tab;
    });
}

const firstOnPack = () => (packs.find(pack => pack.on) ?? packs[0])?.id;

function fillPackSelect(select, value) {
    select.replaceChildren(...packs.map(pack => new Option(pack.name, pack.id)));
    select.value = value;
    select.ariaLabel = "Pack";
    return select;
}

// Save only shows once something in the row has changed
function showSaveWhenEdited(item, save) {
    save.hidden = true;
    item.addEventListener("input", () => save.hidden = false);
    item.addEventListener("change", () => save.hidden = false);
}

function input(value, maxLength, label) {
    return Object.assign(el("input", "link-input"), { value, maxLength, placeholder: label, ariaLabel: label, autocomplete: "off" });
}

function button(text, className, onclick) {
    return Object.assign(el("button", className, text), { type: "button", onclick });
}

function done(result, text) {
    message(result.ok ? text : result.data.error, result.ok);
    return result.ok;
}

function message(text, ok) {
    $("adminMessage").textContent = text;
    $("adminMessage").classList.toggle("error", !ok);
    $("adminMessage").hidden = !text;
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
    return { ok: response.ok, data };
}

if (!await load()) selectTab($("cardsTab")); // Nothing to review, so start on the cards
