// Together mode: Discord sign-in, then rooms where everyone's marks and wins show up live
import { io } from "/socket.io/socket.io.esm.min.js";
import { drawBoard, setCrossed, captureScreenshot } from "./core.js";
import { countLines } from "./shared/lines.js";

const $ = id => document.getElementById(id);
const code = location.pathname.match(/^\/r\/([A-Za-z0-9]{5})$/)?.[1].toUpperCase();
const me = await fetch("/api/me").then(response => response.ok ? response.json() : null);
const listNames = new Intl.ListFormat("en-AU", { type: "conjunction" });
let state = null;         // What the server last said about the room
let marked = new Set();   // My marked squares
let bestLines = 0;        // Most lines on my card this round, so only a new line takes a screenshot
const pulses = new Map(); // Square index -> timer, for squares someone else just spotted

if (me) {
    $("account").hidden = false;
    document.querySelectorAll(".my-avatar").forEach(img => img.src = me.avatar);
    document.querySelectorAll(".my-name").forEach(el => el.textContent = me.name); // textContent: names are untrusted
}

if (!me) {
    if (code) {
        $("signInText").textContent = `Sign in with Discord to join room ${code}. Only your Discord name and picture are used.`;
        $("signInLink").href = `/auth/discord?next=/r/${code}`;
    }
    show("signedOut");
} else if (code) {
    joinRoom();
} else {
    showLobby();
}

function show(...ids) {
    for (const id of ["signedOut", "lobby", "roomGone", "game", "sidebar"]) $(id).hidden = !ids.includes(id);
}

function connect() {
    const socket = io();
    socket.on("connect_error", error => {
        if (error.message === "Sign in first") location.reload(); // Signed out in another tab
    });
    return socket;
}

function showLobby() {
    show("lobby");
    const socket = connect();
    const showError = message => {
        $("lobbyError").textContent = message;
        $("lobbyError").hidden = false;
    };

    $("createButton").addEventListener("click", () => {
        $("createButton").disabled = true;
        socket.timeout(5000).emit("room:create", (timedOut, result) => {
            if (result?.code) return location.assign(`/r/${result.code}`);
            showError(result?.error ?? "Couldn't reach the server. Try again.");
            $("createButton").disabled = false;
        });
    });

    $("joinForm").addEventListener("submit", event => {
        event.preventDefault();
        const typed = $("joinCode").value.trim().toUpperCase();
        if (/^[A-Z0-9]{5}$/.test(typed)) location.assign(`/r/${typed}`);
        else showError("Room codes are 5 letters and numbers.");
    });
}

function joinRoom() {
    const socket = connect();

    // Also runs after a dropped connection comes back, which sends the whole room again
    socket.on("connect", () => socket.emit("room:join", { code }, ({ error }) => {
        if (!error) return;
        $("roomGoneText").textContent = error;
        show("roomGone");
        socket.disconnect();
    }));
    socket.on("room:state", newState => {
        state = newState;
        showRoom(socket);
    });
    socket.on("player:update", player => {
        if (!state) return;
        const i = state.players.findIndex(p => p.id === player.id);
        if (i === -1) state.players.push(player);
        else state.players[i] = player;
        showPlayers();
    });
    socket.on("event", event => {
        if (!state) return;
        const i = state.events.findIndex(e => e.id === event.id);
        if (i === -1) state.events.push(event);
        else state.events[i] = event; // Someone else spotted the same thing
        showFeed();
        if (event.type === "spot") pulse(event);
    });

    $("copyInviteButton").addEventListener("click", () => {
        navigator.clipboard.writeText(`${location.origin}/r/${state.code}`).then(() => {
            $("copyInviteLabel").textContent = "Copied!";
            setTimeout(() => $("copyInviteLabel").textContent = "Copy invite link", 2000);
        });
    });
    $("newRoundButton").addEventListener("click", () => {
        if (confirm("Start a new round? Everyone gets a fresh card.")) socket.emit("host:newRound");
    });
    document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach(other => {
            other.setAttribute("aria-selected", other === tab);
            $(other.getAttribute("aria-controls")).hidden = other !== tab;
        });
    }));
}

function showRoom(socket) {
    show("game", "sidebar");
    $("roomCode").textContent = state.code;
    $("roundNumber").textContent = `Round ${state.round.number}`;
    $("newRoundButton").hidden = state.hostId !== me.id;

    marked = new Set(state.card.marked);
    bestLines = state.card.bestLines; // A refresh doesn't screenshot a line you already had
    pulses.forEach(clearTimeout);
    pulses.clear();
    drawBoard(state.card.phrases, (index, crossed) => {
        if (crossed) {
            marked.add(index);
            stopPulse(index);
        } else {
            marked.delete(index);
        }
        socket.emit("card:mark", { round: state.round.number, index, marked: crossed });
        checkBingo();
    });
    marked.forEach(index => setCrossed($("bingoCard").children[index], true));
    $("bingoAlert").hidden = countLines(marked) === 0;
    showPlayers();
    showFeed();
}

function checkBingo() {
    const lines = countLines(marked);
    $("bingoAlert").hidden = lines === 0;
    if (lines > bestLines) {
        bestLines = lines;
        captureScreenshot();
    }
}

function showPlayers() {
    const players = [...state.players].sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
    $("playerList").replaceChildren(...players.map(player => {
        const row = el("li", player.connected ? "person" : "person away");
        row.append(avatar(player), el("span", "person-name", player.name));
        if (player.id === state.hostId) row.append(Object.assign(el("span", "host-crown", "👑"), { title: "Host" }));
        if (player.oneAway) row.append(el("span", "badge", "1 away!"));
        row.append(
            Object.assign(el("span", "person-meta", `${player.marked}/24`), { title: "Squares marked" }),
            Object.assign(el("span", "wins", `🏆 ${player.wins}`), { title: "Wins" })
        );
        return row;
    }));
}

function showFeed() {
    const items = [...state.events].reverse().map(event => {
        const ids = event.type === "spot" ? event.userIds : [event.userId];
        const names = listNames.format(ids.map(id => playerById(id).name));
        const text = el("span", "feed-text");
        if (event.type === "spot") text.append(`${names} spotted `, el("em", "", event.phrase));
        else text.append(`🎉 ${names} got BINGO${event.lines > 1 ? ` (${event.lines} lines)` : ""}`);

        const avatars = el("span", "feed-avatars");
        avatars.append(...ids.map(id => avatar(playerById(id))));
        const item = el("li", event.type === "win" ? "feed-item win" : "feed-item");
        item.append(avatars, text, el("span", "feed-time", formatTime(event.videoTime)));
        return item;
    });
    $("feedList").replaceChildren(...items);
    $("feedEmpty").hidden = items.length > 0;
}

// Someone else spotted a phrase that's on my card too: that square glows with their picture for 10 seconds
function pulse(event) {
    const spotter = event.userIds.at(-1);
    const index = state.card.phrases.indexOf(event.phrase);
    if (spotter === me.id || index === -1 || index === 12 || marked.has(index)) return;
    stopPulse(index);
    const cell = $("bingoCard").children[index];
    cell.classList.add("spotted");
    cell.append(Object.assign(avatar(playerById(spotter)), { className: "spot-avatar" }));
    pulses.set(index, setTimeout(() => stopPulse(index), 10 * 1000));
}

function stopPulse(index) {
    clearTimeout(pulses.get(index));
    pulses.delete(index);
    const cell = $("bingoCard").children[index];
    cell.classList.remove("spotted");
    cell.querySelector(".spot-avatar")?.remove();
}

function playerById(id) {
    return state.players.find(player => player.id === id) ?? { name: "Someone", avatar: "https://cdn.discordapp.com/embed/avatars/0.png" };
}

function avatar(player) {
    return Object.assign(el("img", "avatar"), { src: player.avatar, alt: "" });
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function formatTime(seconds) {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
