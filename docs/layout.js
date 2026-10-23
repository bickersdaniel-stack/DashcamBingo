// The room's panels are tiles in a grid (gridstack, loaded by room.html): drag a title bar to move one,
// drag an edge or corner to resize, x to hide. There are two arrangements, one for when there's a video and one
// for when there isn't, each saved on this device. Narrow screens get a plain stack that can't be moved.
import { load, save } from "./core.js";

const $ = id => document.getElementById(id);
const rows = 12;      // The built-in layouts are this many rows tall, and rows are sized so that fits the window
const narrowPx = 900; // Below this width the tiles stack
const names = { video: "Video", players: "Players", feed: "Feed", wins: "Winning cards" };

// Places on a 12-column grid. Hidden tiles keep a place for when they're shown again
const at = (x, y, w, h) => ({ x, y, w, h });
export const presets = {
    video: {
        Default: { items: { video: at(0, 0, 8, 12), players: at(8, 0, 4, 2), card: at(8, 2, 4, 8), feed: at(8, 10, 4, 2), wins: at(8, 12, 4, 4) }, hidden: ["wins"] },
        Focus: { items: { video: at(0, 0, 9, 12), card: at(9, 0, 3, 6), feed: at(9, 6, 3, 6), players: at(9, 12, 3, 3), wins: at(9, 15, 3, 4) }, hidden: ["players", "wins"] },
        "Three columns": { items: { players: at(0, 0, 2, 4), feed: at(0, 4, 2, 8), video: at(2, 0, 7, 12), card: at(9, 0, 3, 12), wins: at(9, 12, 3, 4) }, hidden: ["wins"] }
    },
    plain: {
        Default: { items: { card: at(0, 0, 8, 12), players: at(8, 0, 4, 4), feed: at(8, 4, 4, 8), wins: at(8, 12, 4, 4), video: at(0, 12, 8, 8) }, hidden: ["wins"] },
        Focus: { items: { card: at(0, 0, 9, 12), feed: at(9, 0, 3, 12), players: at(9, 12, 3, 4), wins: at(9, 16, 3, 4), video: at(0, 12, 9, 8) }, hidden: ["players", "wins"] },
        "Three columns": { items: { players: at(0, 0, 3, 12), card: at(3, 0, 6, 12), feed: at(9, 0, 3, 12), wins: at(9, 12, 3, 4), video: at(3, 12, 6, 8) }, hidden: ["wins"] }
    }
};

let grid = null;
let mode = "plain";    // "video" when there's a video or stream to show, "plain" when there isn't
let applying = false;  // Moving tiles ourselves, which isn't a change to save

const tiles = () => [...$("roomGrid").children];
const tile = id => tiles().find(el => el.getAttribute("gs-id") === id);
const narrow = () => innerWidth < narrowPx;

export function setUpLayout() {
    if (typeof GridStack === "undefined") return; // Its script didn't load: the tiles just sit one under another
    grid = GridStack.init({
        column: 12, cellHeight: 60, margin: 6, float: false, animate: true,
        handle: ".widget-head", resizable: { handles: "e,se,s,sw,w" }, staticGrid: narrow()
    }, $("roomGrid"));
    grid.on("change", () => applying || remember());
    // An iframe under the pointer would swallow the drag, so they ignore the mouse while tiles move
    grid.on("dragstart resizestart", () => document.body.classList.add("moving-tiles"));
    grid.on("dragstop resizestop", () => document.body.classList.remove("moving-tiles"));
    $("roomGrid").addEventListener("click", event => {
        const button = event.target.closest("[data-hide]");
        if (button) hide(button.closest(".grid-stack-item").getAttribute("gs-id"));
    });
    addEventListener("resize", fit);
    $("layoutMenu").hidden = false;
    useLayout("plain");
}

export function useLayout(newMode) {
    mode = newMode;
    if (!grid) return void (tile("video").hidden = mode !== "video");
    apply(layoutFor(mode));
    showMenu();
    fit();
}

// Rows tall enough that the built-in layouts fill the window under the host's controls
export function fit() {
    if (!grid) return;
    grid.setStatic(narrow());
    if (narrow() || $("roomGrid").hidden) return;
    const top = $("roomGrid").getBoundingClientRect().top + $("stage").scrollTop;
    const height = Math.max(24, Math.floor((innerHeight - top - 16) / rows));
    if (height !== grid.getCellHeight()) grid.cellHeight(height);
}

// What this device saved for this arrangement, filling any gaps from the default
function layoutFor(name) {
    const fallback = presets[name].Default;
    let kept = null;
    try { kept = JSON.parse(load(`layout.${name}`)); } catch (e) {}
    return { items: { ...fallback.items, ...kept?.items }, hidden: Array.isArray(kept?.hidden) ? kept.hidden : fallback.hidden };
}

function apply(layout) {
    applying = true;
    grid.batchUpdate();
    for (const el of tiles()) {
        const id = el.getAttribute("gs-id");
        const shown = id === "card" || (!layout.hidden.includes(id) && (id !== "video" || mode === "video"));
        el.hidden = !shown;
        if (shown && !el.gridstackNode) grid.makeWidget(el, { ...layout.items[id], id }); // The id, or gridstack drops gs-id
        else if (shown) grid.update(el, layout.items[id]);
        else if (el.gridstackNode) grid.removeWidget(el, false, false);
    }
    grid.batchUpdate(false);
    applying = false;
}

function remember() {
    if (narrow()) return; // The stack isn't a layout anyone chose
    const items = layoutFor(mode).items;
    for (const { id, x, y, w, h } of grid.save(false)) items[id] = { x, y, w, h };
    const hidden = tiles().map(el => el.getAttribute("gs-id")).filter(id => tile(id).hidden && (id !== "video" || mode === "video"));
    save(`layout.${mode}`, JSON.stringify({ items, hidden }));
}

function hide(id) {
    const el = tile(id);
    el.hidden = true;
    grid.removeWidget(el, false, false);
    remember();
    showMenu();
}

function show(id) {
    const el = tile(id);
    el.hidden = false;
    grid.makeWidget(el, { ...layoutFor(mode).items[id], id }); // Back where it was; anything in the way moves down
    remember();
    showMenu();
}

// The Room layout part of the account menu: the built-in layouts, and which tiles are showing
function showMenu() {
    $("layoutPresets").replaceChildren(...Object.keys(presets[mode]).map(name => {
        const button = Object.assign(document.createElement("button"), { type: "button", className: "pill", textContent: name });
        button.addEventListener("click", () => {
            apply(presets[mode][name]);
            remember();
            showMenu();
        });
        return button;
    }));
    const ids = mode === "video" ? ["video", "players", "feed", "wins"] : ["players", "feed", "wins"];
    $("layoutToggles").replaceChildren(...ids.map(id => {
        const label = Object.assign(document.createElement("label"), { className: "layout-toggle" });
        const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: !tile(id).hidden });
        box.addEventListener("change", () => box.checked ? show(id) : hide(id));
        label.append(box, names[id]);
        return label;
    }));
}
