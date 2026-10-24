// The room's panels are tiles in a grid (gridstack, loaded by room.html): drag a title bar to move one,
// drag an edge or corner to resize, x to hide. There are separate arrangements for with and without a video,
// and for the host (who also has a tile of their own), each saved on this device.
// Narrow screens get a plain stack that can't be moved.
import { load, save } from "./core.js";

const $ = id => document.getElementById(id);
const rows = 12;      // The built-in layouts are this many rows tall, and rows are sized so that fits the window
const narrowPx = 900; // Below this width the tiles stack
const names = { video: "Video", host: "Host controls", players: "Players", feed: "Feed", wins: "Bingo cards", leaderboard: "Leaderboard" };

// Places on a 12-column grid. Hidden tiles keep a place for when they're shown again
const at = (x, y, w, h) => ({ x, y, w, h });
export const presets = {
    video: {
        Default: { items: { video: at(0, 0, 8, 12), players: at(8, 0, 4, 2), card: at(8, 2, 4, 8), feed: at(8, 10, 4, 2), wins: at(8, 12, 4, 4), leaderboard: at(8, 16, 4, 5) }, hidden: ["wins", "leaderboard"] },
        Focus: { items: { video: at(0, 0, 9, 12), card: at(9, 0, 3, 6), feed: at(9, 6, 3, 6), players: at(9, 12, 3, 3), wins: at(9, 15, 3, 4), leaderboard: at(9, 19, 3, 5) }, hidden: ["players", "wins", "leaderboard"] },
        "Three columns": { items: { players: at(0, 0, 2, 4), feed: at(0, 4, 2, 8), video: at(2, 0, 7, 12), card: at(9, 0, 3, 12), wins: at(9, 12, 3, 4), leaderboard: at(9, 16, 3, 5) }, hidden: ["wins", "leaderboard"] }
    },
    plain: {
        Default: { items: { card: at(0, 0, 8, 12), players: at(8, 0, 4, 4), feed: at(8, 4, 4, 8), wins: at(8, 12, 4, 4), leaderboard: at(8, 16, 4, 5), video: at(0, 12, 8, 8) }, hidden: ["wins", "leaderboard"] },
        Focus: { items: { card: at(0, 0, 9, 12), feed: at(9, 0, 3, 12), players: at(9, 12, 3, 4), wins: at(9, 16, 3, 4), leaderboard: at(9, 20, 3, 5), video: at(0, 12, 9, 8) }, hidden: ["players", "wins", "leaderboard"] },
        "Three columns": { items: { players: at(0, 0, 3, 12), card: at(3, 0, 6, 12), feed: at(9, 0, 3, 12), wins: at(9, 12, 3, 4), leaderboard: at(9, 16, 3, 5), video: at(3, 12, 6, 8) }, hidden: ["wins", "leaderboard"] }
    }
};

// The host's tile goes under the video when there is one, or under the feed, which gives up the room
function withHost({ items, hidden }, under) {
    const above = items[under];
    return { items: { ...items, [under]: { ...above, h: above.h - 2 }, host: at(above.x, above.y + above.h - 2, above.w, 2) }, hidden };
}

let grid = null;
let mode = "plain";    // "video" when there's a video or stream to show, "plain" when there isn't
let host = false;      // Whether this person is the host
let applying = false;  // Moving tiles ourselves, which isn't a change to save

const tiles = () => [...$("roomGrid").children];
const tile = id => tiles().find(el => el.getAttribute("gs-id") === id);
const narrow = () => innerWidth < narrowPx;
const key = () => `layout.${mode}${host ? ".host" : ""}`;
// Whether a tile belongs in this arrangement at all (as opposed to being hidden by choice)
const belongs = id => (id !== "video" || mode === "video") && (id !== "host" || host);
const builtIn = () => host
    ? Object.fromEntries(Object.entries(presets[mode]).map(([name, preset]) => [name, withHost(preset, mode === "video" ? "video" : "feed")]))
    : presets[mode];

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

export function useLayout(newMode, isHost = false) {
    mode = newMode;
    host = isHost;
    if (!grid) return tiles().forEach(el => el.hidden = !belongs(el.getAttribute("gs-id")));
    apply(layoutFor());
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
function layoutFor() {
    const fallback = builtIn().Default;
    let kept = null;
    try { kept = JSON.parse(load(key())); } catch (e) {}
    if (!Array.isArray(kept?.hidden)) return fallback;
    // A tile added since this layout was saved starts out the way the default has it
    const added = fallback.hidden.filter(id => !(id in (kept.items ?? {})));
    return { items: { ...fallback.items, ...kept.items }, hidden: [...kept.hidden, ...added] };
}

// Takes every tile off and puts the shown ones back top-left first, so none is pushed aside by a tile
// that's about to move out of its way
function apply(layout) {
    applying = true;
    grid.batchUpdate();
    grid.removeAll(false, false);
    const shown = tiles().map(el => ({ el, id: el.getAttribute("gs-id") }))
        .filter(({ id }) => id === "card" || (belongs(id) && !layout.hidden.includes(id)))
        .map(tile => ({ ...tile, ...layout.items[tile.id] }));
    for (const el of tiles()) el.hidden = !shown.some(tile => tile.el === el);
    shown.sort((a, b) => a.y - b.y || a.x - b.x).forEach(({ el, ...place }) => grid.makeWidget(el, place)); // id included, or gridstack drops gs-id
    grid.batchUpdate(false);
    applying = false;
}

function remember() {
    if (narrow()) return; // The stack isn't a layout anyone chose
    const items = layoutFor().items;
    for (const { id, x, y, w, h } of grid.save(false)) items[id] = { x, y, w, h };
    const hidden = tiles().map(el => el.getAttribute("gs-id")).filter(id => belongs(id) && tile(id).hidden);
    save(key(), JSON.stringify({ items, hidden }));
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
    grid.makeWidget(el, { ...layoutFor().items[id], id }); // Back where it was; anything in the way moves down
    remember();
    showMenu();
}

// The Room layout part of the account menu: the built-in layouts, and which tiles are showing
function showMenu() {
    const layouts = builtIn();
    $("layoutPresets").replaceChildren(...Object.keys(layouts).map(name => {
        const button = Object.assign(document.createElement("button"), { type: "button", className: "pill", textContent: name });
        button.addEventListener("click", () => {
            apply(layouts[name]);
            remember();
            showMenu();
        });
        return button;
    }));
    const ids = Object.keys(names).filter(belongs);
    $("layoutToggles").replaceChildren(...ids.map(id => {
        const label = Object.assign(document.createElement("label"), { className: "layout-toggle" });
        const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: !tile(id).hidden });
        box.addEventListener("change", () => box.checked ? show(id) : hide(id));
        label.append(box, names[id]);
        return label;
    }));
}
