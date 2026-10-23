// Together mode: Discord sign-in, then rooms where everyone's marks and wins show up live
import { io } from "/socket.io/socket.io.esm.min.js";
import { drawBoard, setCrossed, captureScreenshot } from "./core.js";
import { countLines } from "./shared/lines.js";
import { parseYouTubeLink } from "./youtube.js";

const $ = id => document.getElementById(id);
const code = location.pathname.match(/^\/r\/([A-Za-z0-9]{5})$/)?.[1].toUpperCase();
const me = await fetch("/api/me").then(response => response.ok ? response.json() : null);
const listNames = new Intl.ListFormat("en-AU", { type: "conjunction" });
let state = null;         // What the server last said about the room
let marked = new Set();   // My marked squares
let bestLines = 0;        // Most lines on my card this round, so only a new line takes a screenshot
const pulses = new Map(); // Square index -> timer, for squares someone else just spotted
let videoSeenAt = 0;      // When the video's time last arrived, to count on from
let player = null;        // The host's YouTube player
let playerVideoId = null;
let reportTimer = null;
let youTube = null;       // YouTube's player script, loaded once when the host first needs it

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
        const previousRound = state?.round.number;
        state = newState;
        videoSeenAt = Date.now();
        showRoom(socket);
        // A new round while you're here: show how the last one went (not after a refresh or rejoin)
        if (previousRound && state.round.number > previousRound && state.lastRound) showScoreboard(state.lastRound);
    });
    socket.on("room:host", hostId => {
        if (!state) return;
        state.hostId = hostId; // The host was away for a minute and someone else took over
        showVideo(socket);
        showPlayers();
        showFeed();
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
    socket.on("video:update", video => {
        if (!state) return;
        state.round.video = video;
        videoSeenAt = Date.now();
        if (video) showNowPlaying();
        else showVideo(socket); // The host's video couldn't play, so the round counts from its start
    });

    $("copyInviteButton").addEventListener("click", () => {
        navigator.clipboard.writeText(`${location.origin}/r/${state.code}`).then(() => {
            $("copyInviteLabel").textContent = "Copied!";
            setTimeout(() => $("copyInviteLabel").textContent = "Copy invite link", 2000);
        });
    });
    $("hostBar").addEventListener("submit", event => {
        event.preventDefault();
        const text = $("videoLink").value.trim();
        const video = text ? parseYouTubeLink(text) : null;
        if (text && !video) return showHostMessage("That doesn't look like a YouTube link.");
        if (!confirm(`Start a new round${video ? " with this video" : " without a video"}? Everyone gets a fresh card.`)) return;
        $("hostNote").hidden = true;
        $("videoLink").value = "";
        socket.emit("host:newRound", video ? { videoId: video.id, start: video.start } : {});
    });
    document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => selectTab(tab)));
    setInterval(() => state && showNowPlaying(), 1000);
}

function showRoom(socket) {
    show("game", "sidebar");
    $("roomCode").textContent = state.code;
    $("roundNumber").textContent = `Round ${state.round.number}`;

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
        socket.emit("card:mark", { round: state.round.id, index, marked: crossed });
        checkBingo();
    });
    marked.forEach(index => setCrossed($("bingoCard").children[index], true));
    $("bingoAlert").hidden = countLines(marked) === 0;
    showVideo(socket);
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

function showVideo(socket) {
    const isHost = state.hostId === me.id;
    const hosting = isHost && !!state.round.video;
    $("hostBar").hidden = !isHost;
    arrange(hosting);
    if (hosting) startPlayer(socket, state.round.video);
    else stopPlayer();
    showNowPlaying();
}

// A host playing a video gets it large on the left, and their card above the tabs on the right
function arrange(hosting) {
    document.body.classList.toggle("hosting", hosting);
    $("videoColumn").hidden = !hosting;
    if (hosting) $("sidebar").prepend($("game"));
    else $("stage").append($("game"));
}

function selectTab(tab) {
    document.querySelectorAll(".tab").forEach(other => {
        other.setAttribute("aria-selected", other === tab);
        $(other.getAttribute("aria-controls")).hidden = other !== tab;
    });
}

async function startPlayer(socket, video) {
    if (playerVideoId === video.id) return; // Keeps playing through a reconnect
    stopPlayer();
    playerVideoId = video.id;
    youTube ??= new Promise(resolve => {
        window.onYouTubeIframeAPIReady = () => resolve(window.YT);
        document.head.append(Object.assign(document.createElement("script"), { src: "https://www.youtube.com/iframe_api" }));
    });
    const YT = await youTube;
    if (playerVideoId !== video.id) return; // Another round started while the script loaded

    const holder = document.createElement("div");
    $("videoFrame").replaceChildren(holder);
    const report = () => {
        if (!player?.getCurrentTime) return; // Not ready yet
        socket.emit("host:video", {
            videoId: video.id, title: player.getVideoData()?.title ?? "",
            time: player.getCurrentTime(), playing: player.getPlayerState() === YT.PlayerState.PLAYING
        });
    };
    player = new YT.Player(holder, {
        videoId: video.id,
        playerVars: { start: Math.floor(videoSecondsNow()), playsinline: 1, rel: 0 }, // A new host picks up where it's got to
        events: { onReady: report, onStateChange: report, onError: event => videoFailed(socket, video.id, event.data) }
    });
    reportTimer = setInterval(report, 1000);
}

function stopPlayer() {
    clearInterval(reportTimer);
    player?.destroy?.();
    player = null;
    playerVideoId = null;
    $("videoFrame").replaceChildren();
}

// Some videos aren't allowed to play outside YouTube (errors 101 and 150)
function videoFailed(socket, id, error) {
    showHostMessage(error === 101 || error === 150
        ? "This video can't play here. Play it on YouTube and share that tab instead."
        : "This video can't be played here. Check the link, or play it on YouTube and share that tab instead.");
    $("hostYouTubeLink").href = `https://www.youtube.com/watch?v=${id}`;
    $("hostYouTubeLink").hidden = false;
    socket.emit("host:videoFailed");
}

function showHostMessage(text) {
    $("hostMessage").textContent = text;
    $("hostYouTubeLink").hidden = true;
    $("hostNote").hidden = false;
}

function replay(event) {
    player?.seekTo?.(Math.max(0, event.videoTime - 5), true);
    player?.playVideo?.();
}

// Players see where the host's video is up to, counting on between the host's reports
function showNowPlaying() {
    const video = state.round.video;
    $("nowPlaying").hidden = !video || state.hostId === me.id;
    if ($("nowPlaying").hidden) return;
    $("nowPlayingTitle").textContent = video.title || "the host's video";
    $("nowPlayingTime").textContent = formatTime(Math.floor(videoSecondsNow()));
}

function videoSecondsNow() {
    const video = state.round.video;
    return video.time + (video.playing ? (Date.now() - videoSeenAt) / 1000 : 0);
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
        else if (event.type === "host") text.append(`👑 ${names} is now the host`);
        else text.append(`🎉 ${names} got BINGO${event.lines > 1 ? ` (${event.lines} lines)` : ""}`);

        const avatars = el("span", "feed-avatars");
        avatars.append(...ids.map(id => avatar(playerById(id))));
        const item = el("li", event.type === "win" ? "feed-item win" : "feed-item");
        // The host can click a moment from this video to watch it again, from 5 seconds before
        const replayable = playerVideoId !== null && event.videoId === playerVideoId;
        const time = el(replayable ? "button" : "span", replayable ? "feed-time replay" : "feed-time", formatTime(event.videoTime));
        if (replayable) {
            time.type = "button";
            time.title = "Replay from 5 seconds before";
            item.classList.add("replayable");
            item.addEventListener("click", () => replay(event));
        }
        item.append(avatars, text, time);
        return item;
    });
    $("feedList").replaceChildren(...items);
    $("feedEmpty").hidden = items.length > 0;
}

function showScoreboard(summary) {
    $("scoreboardTitle").textContent = `Round ${summary.number} results`;
    $("scoreboardVideo").textContent = summary.videoTitle ?? "";
    $("scoreboardVideo").hidden = !summary.videoTitle;
    $("scoreList").replaceChildren(...summary.players.map((player, i) => {
        const result = player.lines > 0
            ? `🎉 BINGO${player.bingoAt !== null ? ` at ${formatTime(player.bingoAt)}` : ""}${player.lines > 1 ? ` · ${player.lines} lines` : ""}`
            : player.oneAway ? "1 away" : `${player.marked}/24 marked`;
        const row = el("li", player.lines > 0 ? "score winner" : "score");
        row.append(el("span", "score-rank", String(i + 1)), avatar(player), el("span", "person-name", player.name),
            el("span", "score-result", result), Object.assign(el("span", "wins", `🏆 ${player.wins}`), { title: "Wins so far" }));
        return row;
    }));
    if (summary.players.length === 0) $("scoreList").append(el("li", "score", "Nobody marked anything."));
    $("scoreboardClose").textContent = `On to round ${summary.number + 1}`;
    if (!$("scoreboard").open) $("scoreboard").showModal();
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
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    const rest = String(seconds % 60).padStart(2, "0");
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}
