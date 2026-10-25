// Admin page: review suggested squares, edit every card and its description, sort cards into packs and tick them into
// game modes, manage people, and set how many coins players earn
const $ = id => document.getElementById(id);
const pageSize = 25;
const pages = { card: 1, user: 1 }; // The page each long list is on
const coinKeys = ["bingoCoins", "coinsPerRound", "countCoinsPerDay"]; // Also the ids of their inputs
let packs = [];
let modes = [];
let cards = [];
let users = [];

document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => selectTab(tab)));
["cardSearch", "cardPackFilter", "cardModeFilter", "cardSort"].forEach(id => $(id).addEventListener("input", () => {
    pages.card = 1;
    showCards();
}));
$("userSearch").addEventListener("input", () => {
    pages.user = 1;
    showUsers();
});

$("newCardForm").addEventListener("submit", async event => {
    event.preventDefault();
    const result = await api("POST", "/api/admin/cards", {
        text: $("newCardText").value, description: $("newCardDescription").value, pack: $("newCardPack").value,
        modes: [...$("newCardModes").querySelectorAll("input:checked")].map(box => box.value)
    });
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

$("newModeForm").addEventListener("submit", async event => {
    event.preventDefault();
    const result = await api("POST", "/api/admin/modes", { name: $("newModeName").value, description: $("newModeDescription").value });
    if (!done(result, "Mode added. Tick cards into it on the Cards tab.")) return;
    $("newModeName").value = $("newModeDescription").value = "";
    load();
});

showSaveWhenEdited($("coinsForm"), $("coinsSave"));
$("coinsForm").addEventListener("submit", async event => {
    event.preventDefault();
    const result = await api("PATCH", "/api/admin/settings", Object.fromEntries(coinKeys.map(key => [key, $(key).valueAsNumber])));
    if (done(result, "Saved.")) load();
});

async function load() {
    const [all, waiting, people, settings] = await Promise.all([
        api("GET", "/api/admin/cards"), api("GET", "/api/admin/suggestions"), api("GET", "/api/admin/users"), api("GET", "/api/admin/settings")
    ]);
    if (!all.ok) return message(all.data.error, false);
    if (!people.ok) return message(people.data.error, false);
    ({ packs, modes, cards } = all.data);
    users = people.data;
    fillPackSelect($("newCardPack"), $("newCardPack").value || firstOnPack());
    const filter = $("cardPackFilter").value;
    $("cardPackFilter").replaceChildren(new Option("All packs", "all"), ...packs.map(pack => new Option(pack.name, pack.id)));
    $("cardPackFilter").value = packs.some(pack => pack.id === filter) ? filter : "all";
    const modeFilter = $("cardModeFilter").value;
    $("cardModeFilter").replaceChildren(new Option("All modes", "all"), ...modes.map(mode => new Option(mode.name, mode.id)));
    $("cardModeFilter").value = modes.some(mode => mode.id === modeFilter) ? modeFilter : "all";
    $("newCardModes").replaceChildren(...modes.map(mode => {
        const label = el("label", "check-label");
        label.append(Object.assign(document.createElement("input"), { type: "checkbox", value: mode.id, checked: mode.id === "normal" }), ` ${mode.name}`);
        return label;
    }));
    showSuggestions(waiting.data.pending ?? []);
    showCards();
    showPacks();
    showModes();
    showUsers();
    showCoins(settings.data);
    return waiting.data.pending?.length ?? 0;
}

function showSuggestions(list) {
    $("suggestionsTab").textContent = list.length ? `Suggestions (${list.length})` : "Suggestions";
    $("pendingList").replaceChildren(...(list.length ? list : [null]).map(s => {
        if (!s) return el("li", "item empty", "Nothing waiting. 🎉");
        const item = el("li", "item admin-row");
        const text = input(s.text, 60, "Square wording");
        const description = textarea(s.description ?? "", "Description (optional)");
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
    const modeFilter = $("cardModeFilter").value;
    const sort = $("cardSort").value;
    const shown = cards
        .filter(card => (filter === "all" || card.pack === filter) && (modeFilter === "all" || card.modes.includes(modeFilter))
            && (`${card.text} ${card.description}`).toLowerCase().includes(search))
        .sort((a, b) => {
            if (sort === "az") return a.text.localeCompare(b.text);
            const [ra, rb] = [rate(a), rate(b)];
            if (ra === null || rb === null) return (ra === null) - (rb === null) || a.text.localeCompare(b.text); // Too few games go last
            return sort === "most" ? rb - ra : ra - rb;
        });
    $("cardCount").textContent = `${shown.length} of ${cards.length} cards`;
    showPager("card", shown.length, showCards);
    $("cardList").replaceChildren(...(shown.length ? onePage("card", shown) : [null]).map(card => {
        if (!card) return el("li", "item empty", "No cards match.");
        const item = el("li", "item admin-row");
        const text = input(card.text, 60, "Card wording");
        const description = textarea(card.description, "Description (optional)");
        const pack = fillPackSelect(el("select", "quality-select pack-select"), card.pack);
        const counted = Object.assign(input(String(card.counted ?? 0), 6, `Counted for ${card.text}`), { type: "number", min: 0, max: 100000 });
        const spotted = Object.assign(input(String(card.spotted ?? 0), 6, `Marked deals for ${card.text}`), { type: "number", min: 0, max: 100000 });
        const dealt = Object.assign(input(String(card.dealt ?? 0), 6, `Deals for ${card.text}`), { type: "number", min: 0, max: 100000 });
        counted.classList.add("wins-input");
        spotted.classList.add("wins-input");
        dealt.classList.add("wins-input");
        const stats = el("span", "admin-counts");
        const countedLabel = el("label", "check-label", "Counted ");
        const markedLabel = el("label", "check-label", "Marked ");
        countedLabel.append(counted);
        markedLabel.append(spotted, " / ", dealt);
        stats.append(countedLabel, markedLabel);
        stats.title = "Counted is every sighting. Marked / dealt is how often it was on a card and got marked.";
        const save = button("Save", "btn btn-primary", async () => {
            const result = await api("PATCH", `/api/admin/cards/${card.id}`, {
                text: text.value, description: description.value, pack: pack.value,
                counted: Number(counted.value), spotted: Number(spotted.value), dealt: Number(dealt.value)
            });
            if (done(result, "Saved.")) load();
        });
        const remove = button("Delete", "link-button", async () => {
            if (!confirm(`Delete "${card.text}"? It comes off every new card.`)) return;
            if (done(await api("DELETE", `/api/admin/cards/${card.id}`), "Deleted.")) load();
        });
        showSaveWhenEdited(item, save);
        item.append(text, description, pack, modeTicks(card), stats, el("span", "item-by", card.by ? `from ${card.by.name}` : ""), save, remove);
        return item;
    }));
}

// One tick box per game mode. Each saves the moment it's ticked, without the row's Save, so filling a mode is quick
function modeTicks(card) {
    const ticks = el("span", "mode-ticks");
    ticks.append(...modes.map(mode => {
        const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: card.modes.includes(mode.id) });
        const label = el("label", "check-label");
        label.append(box, ` ${mode.name}`);
        const stay = event => event.stopPropagation(); // So the row doesn't think it has unsaved edits
        box.addEventListener("input", stay);
        box.addEventListener("change", async event => {
            stay(event);
            const next = modes.filter(m => m.id === mode.id ? box.checked : card.modes.includes(m.id)).map(m => m.id);
            const result = await api("PATCH", `/api/admin/cards/${card.id}`, { modes: next });
            if (!done(result, `"${card.text}" is ${box.checked ? "in" : "out of"} ${mode.name}.`)) return box.checked = !box.checked;
            card.modes = result.data.modes;
            mode.count += box.checked ? 1 : -1;
            showModes();
        });
        return label;
    }));
    return ticks;
}

function showModes() {
    $("modeList").replaceChildren(...modes.map(mode => {
        const item = el("li", "item admin-row");
        const name = input(mode.name, 30, "Mode name");
        const description = input(mode.description, 140, "Description (optional)");
        const save = button("Save", "btn btn-primary", async () => {
            const result = await api("PATCH", `/api/admin/modes/${mode.id}`, { name: name.value, description: description.value });
            if (done(result, "Saved.")) load();
        });
        const remove = mode.id === "normal" ? el("span", "") : button("Delete", "link-button", async () => {
            if (!confirm(`Delete the "${mode.name}" mode? Its cards stay in their other modes.`)) return;
            if (done(await api("DELETE", `/api/admin/modes/${mode.id}`), "Deleted.")) load();
        });
        showSaveWhenEdited(item, save);
        const count = `${mode.count} card${mode.count === 1 ? "" : "s"}${mode.count < 24 ? " · needs 24" : ""}`;
        item.append(name, description, el("span", "admin-stats", count), save, remove);
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

const signedInWith = { discord: "Discord", google: "Google", email: "Email link" };

function showUsers() {
    const search = $("userSearch").value.trim().toLowerCase();
    const shown = users.filter(user => user.name.toLowerCase().includes(search));
    $("userCount").textContent = `${shown.length} of ${users.length} people`;
    showPager("user", shown.length, showUsers);
    $("userList").replaceChildren(...(shown.length ? onePage("user", shown) : [null]).map(user => {
        if (!user) return el("li", "item empty", "Nobody matches.");
        const item = el("li", "item admin-row user-row");
        const change = async (body, text) => {
            if (done(await api("PATCH", `/api/admin/users/${encodeURIComponent(user.id)}`, body), text)) load();
        };
        const who = el("span", "user-who");
        const seen = user.seenAt ? `last seen ${new Date(user.seenAt).toLocaleDateString()}` : "not seen since this update";
        who.append(el("strong", "", user.name), el("span", "item-by", `${signedInWith[user.via]} · ${seen}`));
        const tags = [user.owner ? "Owner" : user.admin && "Admin", user.blocked && "Blocked"].filter(Boolean);
        const wins = Object.assign(input(String(user.wins), 6, `Wins for ${user.name}`), { type: "number", min: 0, max: 100000 });
        wins.classList.add("wins-input");
        const winsLabel = el("label", "check-label", "🏆 ");
        winsLabel.append(wins);
        const coins = Object.assign(input(String(user.coins), 8, `Coins for ${user.name}`), { type: "number", min: 0, max: 1000000 });
        coins.classList.add("wins-input", "coins-input");
        const coinsLabel = el("label", "check-label", "🪙 ");
        coinsLabel.append(coins);
        // Only what you edited: coins tick up while they play, so sending the number shown at load would undo them
        const save = button("Save", "btn btn-primary", () => change({
            ...(Number(wins.value) !== user.wins && { wins: Number(wins.value) }),
            ...(Number(coins.value) !== user.coins && { coins: Number(coins.value) })
        }, `Saved ${user.name}.`));
        showSaveWhenEdited(item, save);
        item.append(Object.assign(el("img", "avatar"), { src: user.avatar, alt: "" }), who, ...tags.map(tag => el("span", `user-tag tag-${tag.toLowerCase()}`, tag)),
            winsLabel, coinsLabel, save, el("span", "admin-stats", `Suggested ${user.suggested} · ${user.approved} added`));
        if (!user.owner) {
            item.append(button(user.admin ? "Remove admin" : "Make admin", "btn btn-quiet",
                () => change({ admin: !user.admin }, user.admin ? `${user.name} isn't an admin now.` : `${user.name} is an admin now.`)));
            item.append(button(user.blocked ? "Unblock" : "Block", user.blocked ? "btn btn-quiet" : "btn btn-quiet danger", () => {
                if (!user.blocked && !confirm(`Block ${user.name}? They're taken out of any room they're in, and can't join rooms or suggest squares until you unblock them.`)) return;
                change({ blocked: !user.blocked }, user.blocked ? `Unblocked ${user.name}.` : `Blocked ${user.name}.`);
            }));
        }
        return item;
    }));
}

function showCoins(settings) {
    for (const key of coinKeys) $(key).value = settings[key];
    $("coinsSave").style.visibility = "hidden"; // Until one is edited again
}

// One page of a long list; the page stays in range when the list gets shorter
function onePage(name, list) {
    pages[name] = Math.min(pages[name], Math.ceil(list.length / pageSize) || 1);
    return list.slice((pages[name] - 1) * pageSize, pages[name] * pageSize);
}

function showPager(name, total, redraw) {
    const count = Math.ceil(total / pageSize);
    const page = Math.min(pages[name], count || 1);
    const go = to => () => {
        pages[name] = to;
        redraw();
        $(`${name}List`).scrollIntoView({ block: "start", behavior: "smooth" });
    };
    const previous = button("‹ Previous", "btn btn-quiet", go(page - 1));
    const next = button("Next ›", "btn btn-quiet", go(page + 1));
    previous.disabled = page === 1;
    next.disabled = page === count;
    $(`${name}Pager`).replaceChildren(previous, el("span", "pager-label", `Page ${page} of ${count}`), next);
    $(`${name}Pager`).hidden = count <= 1;
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

// Save only shows once something in the row has changed; it keeps its space so the row doesn't shift
function showSaveWhenEdited(item, save) {
    save.style.visibility = "hidden";
    const show = () => save.style.visibility = "";
    item.addEventListener("input", show);
    item.addEventListener("change", show);
}

function input(value, maxLength, label) {
    return Object.assign(el("input", "link-input"), { value, maxLength, placeholder: label, ariaLabel: label, autocomplete: "off" });
}

// A card description can run over several lines; the box grows with it
function textarea(value, label) {
    return Object.assign(el("textarea", "link-input"), { value, maxLength: 300, rows: 1, placeholder: label, ariaLabel: label });
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
