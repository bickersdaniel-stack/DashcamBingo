// Together mode: sign in (Discord, Google or an email link), then rooms where everyone's marks and wins show up live
import { io } from "/socket.io/socket.io.esm.min.js";
import { drawBoard, captureScreenshot, setTheme, pickColour, presetColours, load, save } from "./core.js";
import { cardRow, playerRow } from "./board.js";
import { setUpLayout, useLayout } from "./layout.js";
import { countLines } from "./shared/lines.js";
import { parseYouTubeLink } from "./youtube.js";

const $ = id => document.getElementById(id);
const code = location.pathname.match(/^\/r\/([A-Za-z0-9]{5})$/)?.[1].toUpperCase();
const meResponse = await fetch("/api/me");
const me = meResponse.ok ? await meResponse.json() : null;
const signInOptions = me ? {} : await meResponse.json().catch(() => ({})); // Which ways to sign in are set up
const listNames = new Intl.ListFormat("en-AU", { type: "conjunction" });
let state = null;         // What the server last said about the room
let marked = new Set();   // My marked squares
let bestLines = 0;        // Most lines on my card this round, so only a new line takes a screenshot
const pulses = new Map(); // Square index -> timer, for squares someone else just spotted
let videoSeenAt = 0;      // When the video's time last arrived, to count on from
let player = null;        // The host's YouTube player
let playerVideoId = null;
let playerFailedId = null; // Embed-blocked clip; don't keep recreating the player
let reportTimer = null;
let youTube = null;       // YouTube's player script, loaded once when the host first needs it
// The live stream goes straight from the host's browser to each viewer's (WebRTC); the server only introduces them
const iceServers = [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" }];
let shareStream = null;    // Host: what they're sharing
const viewers = new Map(); // Host: viewer's socket id -> their connection
let watchPeer = null;      // Viewer: the connection to the host
let watchingFrom = null;   // Viewer: the host's socket id
const departed = new Map(); // People who left the room, so their old feed items keep their names
// Host quality: YouTube + capture stay at this size; the iframe is CSS-scaled to the frame
const qualities = {
    auto: { width: 1280, height: 720, yt: "default" },
    480: { width: 854, height: 480, yt: "large" },
    720: { width: 1280, height: 720, yt: "hd720" },
    1080: { width: 1920, height: 1080, yt: "hd1080" }
};

if (me) {
    $("account").hidden = false;
    document.querySelectorAll(".my-avatar").forEach(img => img.src = me.avatar);
    document.querySelectorAll(".my-name").forEach(el => el.textContent = me.name); // textContent: names are untrusted
    showMyWins(me.wins);
    showMyCoins(me.coins ?? 0);
    setUpMenu("account", "account");
    setUpSuggestions();
    welcome();
}

if (!me) {
    showSignIn();
} else if (code) {
    joinRoom();
} else {
    showLobby();
}

function showSignIn() {
    const next = code ? `?next=/r/${code}` : ""; // Back to the room link afterwards
    if (code) $("signInText").textContent = `Sign in to join room ${code}. Only your name and picture are used.`;
    $("signInLink").href = `/auth/discord${next}`;
    $("googleLink").href = `/auth/google${next}`;
    $("googleLink").hidden = !signInOptions.google;
    $("emailForm").hidden = !signInOptions.email;
    $("emailForm").addEventListener("submit", async event => {
        event.preventDefault();
        const email = $("emailAddress").value.trim();
        const result = await api("POST", "/auth/email", { email, name: $("emailName").value, next: code ? `/r/${code}` : undefined });
        $("emailMessage").textContent = result.ok
            ? `Check your inbox: a sign-in link is on its way to ${email}. It works once, for 15 minutes.`
            : result.data.error;
        $("emailMessage").classList.toggle("error", !result.ok);
        $("emailMessage").hidden = false;
    });
    show("signedOut");
}

function show(...ids) {
    for (const id of ["signedOut", "lobby", "setup", "roomGone", "roomGrid"]) $(id).hidden = !ids.includes(id);
    document.body.classList.toggle("in-room", ids.includes("roomGrid"));
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
    const showError = (message, id = "lobbyError") => {
        $(id).textContent = message;
        $(id).hidden = false;
    };

    $("setupButton").addEventListener("click", async () => {
        await fillRoomOptions(null, 0);
        show("setup");
        $("createLink").focus();
    });
    $("setupBack").addEventListener("click", () => show("lobby"));
    $("setup").addEventListener("submit", event => {
        event.preventDefault();
        const text = $("createLink").value.trim();
        const video = text ? parseYouTubeLink(text) : null;
        if (text && !video) return showError("That doesn't look like a YouTube link. Leave it empty to add a video later.", "setupError");
        if (!showPackTotal()) return;
        $("createButton").disabled = true;
        const payload = { rerolls: Number($("roomRerolls").value), packs: chosenPacks() };
        if (video) Object.assign(payload, { videoId: video.id, start: video.start });
        socket.timeout(5000).emit("room:create", payload, (timedOut, result) => {
            if (result?.code) return location.assign(`/r/${result.code}`);
            showError(result?.error ?? "Couldn't reach the server. Try again.", "setupError");
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
        if (state.round.number !== previousRound) showMiniBoard(); // Wins may have changed
    });
    socket.on("room:gone", message => leaveRoomView(socket, message)); // The host ended it, or you left in another tab
    socket.on("player:left", id => {
        if (!state) return;
        const gone = state.players.find(player => player.id === id);
        if (gone) departed.set(id, gone);
        state.players = state.players.filter(player => player.id !== id);
        showPlayers();
    });
    $("roomMenu").hidden = false;
    setUpMenu("room", "roomMenu");
    $("leaveButton").hidden = false;
    $("leaveButton").addEventListener("click", () => socket.timeout(5000).emit("room:leave", () => location.assign("/")));
    $("endRoomButton").addEventListener("click", () => {
        if (confirm("End this room for everyone? Everyone goes back to the start.")) socket.timeout(5000).emit("room:end", () => location.assign("/"));
    });
    socket.on("room:host", hostId => {
        if (!state) return;
        state.hostId = hostId; // The host was away for a minute and someone else took over
        showVideo(socket);
        showPlayers();
        showFeed();
        showReroll();
    });
    socket.on("player:update", player => {
        if (!state) return;
        const i = state.players.findIndex(p => p.id === player.id);
        if (i === -1) state.players.push(player);
        else state.players[i] = player;
        if (player.id === me.id) showMyWins(player.wins);
        showPlayers();
    });
    socket.on("event", event => {
        if (!state) return;
        const i = state.events.findIndex(e => e.id === event.id);
        if (i === -1) state.events.push(event);
        else state.events[i] = event; // Someone else spotted the same thing
        showFeed();
        if (event.type === "spot" && !(event.cleared ?? []).length) pulse(event);
        if (event.type === "win") showMiniBoard(); // A bingo (or one taken back) changes the wins
    });
    socket.on("video:update", video => {
        if (!state) return;
        const idChanged = video?.id !== state.round.video?.id;
        state.round.video = video;
        videoSeenAt = Date.now();
        if (idChanged) showVideo(socket); // New video, or the host's video couldn't play
        else if (video) showNowPlaying();
    });
    socket.on("stream:live", from => {
        if (!state) return;
        state.streamFrom = from;
        watch(socket);
    });
    socket.on("rerolls:update", rerolls => {
        if (!state) return;
        state.rerolls = rerolls;
        showReroll();
        showRerollLock();
    });
    socket.on("packs:update", packs => {
        if (state) state.packs = packs;
    });
    socket.on("rtc:signal", ({ from, data }) => {
        if (shareStream && data?.type === "hello") return sendStream(socket, from);
        const peer = shareStream ? viewers.get(from) : from === watchingFrom ? watchPeer : null;
        if (peer) handleSignal(socket, peer, from, data);
    });
    socket.on("rtc:left", dropViewer);

    $("copyInviteButton").addEventListener("click", () => {
        navigator.clipboard.writeText(`${location.origin}/r/${state.code}`).then(() => {
            $("copyInviteLabel").textContent = "Copied!";
            setTimeout(() => $("copyInviteLabel").textContent = "Copy invite link", 2000);
        });
    });
    $("hostBar").addEventListener("submit", event => {
        event.preventDefault();
        const video = readVideoLink();
        if (video === false) return;
        if (!video) return showHostMessage("Paste a YouTube link first.");
        $("hostNote").hidden = true;
        socket.emit("host:setVideo", { videoId: video.id, start: video.start });
    });
    // Start round and Room settings are in both the Room menu and the host tile
    document.querySelectorAll(".start-round").forEach(button => button.addEventListener("click", () => {
        setPanelOpen("room", false);
        const video = readVideoLink();
        if (video === false) return;
        const untouched = state.events.length === 0 && state.players.every(player => player.marked === 0);
        if (!untouched && !confirm(`Start a new round${video ? " with this video" : " without a video"}? Everyone gets a fresh card.`)) return;
        $("hostNote").hidden = true;
        socket.emit("host:newRound", video ? { videoId: video.id, start: video.start } : {});
        if (video && !shareStream) startSharing(socket); // Browser still shows the picker the first time
    }));
    // Locking sets rerolls to Off; unlocking puts back what they were (one, if they were never on)
    let unlockedRerolls = 1;
    $("lockRerollsButton").addEventListener("click", () => {
        if (state.rerolls) unlockedRerolls = state.rerolls;
        socket.emit("host:rerolls", { rerolls: state.rerolls ? 0 : unlockedRerolls });
    });
    const savedQuality = load("streamQuality");
    if (qualities[savedQuality]) $("streamQuality").value = savedQuality;
    $("streamQuality").addEventListener("change", () => {
        save("streamQuality", $("streamQuality").value);
        scalePlayer();
        applyQuality();
        applyCaptureQuality();
    });
    document.querySelectorAll(".open-settings").forEach(button => button.addEventListener("click", async () => {
        setPanelOpen("room", false);
        $("settingsForm").prepend($("roomOptions"));
        await fillRoomOptions(state.packs, state.rerolls ?? 0);
        $("settingsDialog").showModal();
    }));
    $("settingsCancel").addEventListener("click", () => $("settingsDialog").close());
    $("settingsForm").addEventListener("submit", event => {
        event.preventDefault();
        if (!showPackTotal()) return;
        socket.emit("host:packs", { packs: chosenPacks() });
        socket.emit("host:rerolls", { rerolls: Number($("roomRerolls").value) });
        $("settingsDialog").close();
    });
    setUpCardTips();
    $("rerollButton").addEventListener("click", () => socket.emit("card:reroll", { round: state.round.id }));
    $("shareButton").hidden = !navigator.mediaDevices?.getDisplayMedia; // Phones can't share their screen
    $("shareButton").addEventListener("click", () => shareStream ? stopSharing(socket) : startSharing(socket));
    setUpLayout();
    new ResizeObserver(() => { if (player) scalePlayer(); }).observe($("videoFrame"));
    $("soundButton").addEventListener("click", () => {
        $("liveVideo").muted = false;
        $("soundButton").hidden = true;
    });
    const savedVolume = Number(load("streamVolume"));
    if (savedVolume >= 0 && savedVolume <= 1) $("streamVolume").value = String(savedVolume);
    $("streamVolume").addEventListener("input", applyStreamVolume);
    setInterval(() => state && showNowPlaying(), 1000);
}

function showRoom(socket) {
    show("roomGrid");
    $("roomCode").textContent = state.code;
    $("roundNumber").textContent = `Round ${state.round.number}`;

    marked = new Set(state.card.counts.flatMap((count, index) => count > 0 ? [index] : []));
    bestLines = state.card.bestLines; // A refresh doesn't screenshot a line you already had
    pulses.forEach(clearTimeout);
    pulses.clear();
    drawBoard(state.card.phrases, (index, count, change) => {
        if (count > 0) {
            marked.add(index);
            stopPulse(index);
        } else {
            marked.delete(index);
        }
        socket.emit("card:count", { round: state.round.id, index, delta: change }, ({ gained, coins }) => {
            showMyCoins(coins);
            if (gained > 0) popCoins($("bingoCard").children[index], gained);
        });
        checkBingo();
        showReroll();
    }, state.card.notes, state.card.counts);
    $("bingoAlert").hidden = countLines(marked) === 0;
    showReroll();
    showRerollLock();
    showVideo(socket);
    showPlayers();
    showFeed();
    if (shareStream && state.streamFrom !== socket.id) socket.emit("stream:start"); // Back after a dropped connection
    watch(socket);
}

function showReroll() {
    const left = Math.max(0, (state.rerolls ?? 0) - (state.card.rerollsUsed ?? 0));
    $("rerollButton").hidden = !state.rerolls;
    $("rerollButton").disabled = left === 0 || marked.size > 0 || state.card.bestLines > 0;
    $("rerollLabel").textContent = left === 1 ? "Reroll (1 left)" : `Reroll (${left} left)`;
    $("rerollButton").title = marked.size || state.card.bestLines ? "Reroll before you mark anything" : "";
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
    const withVideo = hosting || !$("liveVideo").hidden;
    $("hostBar").hidden = !isHost;
    $("endRoomButton").hidden = $("roomHostActions").hidden = !isHost;
    // The host's video controls sit in the video tile's title bar once there's a video, and in the Room menu until then
    $(isHost && withVideo ? "videoTools" : "roomVideoSlot").append($("hostBar"));
    $("setVideoButton").textContent = withVideo ? "Change video" : "Set video";
    $("videoLabel").hidden = isHost && withVideo;
    $("roomVideoSection").hidden = !isHost || withVideo;
    if (isHost) fillLockedLink();
    arrange(withVideo, isHost);
    if (hosting) startPlayer(socket, state.round.video);
    else stopPlayer();
    if (shareStream) cropShare();
    showNowPlaying();
}

// Keep the last link in the field so Start round and Change video reuse it
function fillLockedLink() {
    const input = $("videoLink");
    if (input.dataset.filled) return;
    input.dataset.filled = "1";
    if (!input.value.trim() && state.round.video?.id) input.value = `https://www.youtube.com/watch?v=${state.round.video.id}`;
}

function readVideoLink() {
    const text = $("videoLink").value.trim();
    const video = text ? parseYouTubeLink(text) : null;
    if (text && !video) {
        showHostMessage("That doesn't look like a YouTube link.");
        return false;
    }
    return video;
}

// A host playing a video, or a viewer watching the host's stream, gets the tiles laid out around the video;
// the host also gets their own tile
function arrange(withVideo, isHost = false) {
    useLayout(withVideo ? "video" : "plain", isHost);
}

// The host tile's lock: locked means rerolls are off, so nobody can reroll
function showRerollLock() {
    const locked = !state.rerolls;
    $("lockRerollsButton").setAttribute("aria-pressed", locked);
    $("lockRerollsLabel").textContent = locked ? "Unlock rerolls" : "Lock rerolls";
    $("rerollStatus").textContent = locked ? "Nobody can reroll." : `Everyone can reroll ${state.rerolls === 1 ? "once" : `${state.rerolls} times`} a round.`;
}

async function startPlayer(socket, video) {
    if (playerFailedId === video.id) return;
    if (playerFailedId && playerFailedId !== video.id) playerFailedId = null;
    if (playerVideoId === video.id) { // Keeps playing through a reconnect
        scalePlayer();
        applyQuality();
        return;
    }
    if (player?.loadVideoById) {
        playerVideoId = video.id;
        player.loadVideoById({ videoId: video.id, startSeconds: Math.floor(videoSecondsNow()) });
        scalePlayer();
        applyQuality();
        return;
    }
    stopPlayer();
    playerVideoId = video.id;
    youTube ??= new Promise(resolve => {
        window.onYouTubeIframeAPIReady = () => resolve(window.YT);
        document.head.append(Object.assign(document.createElement("script"), { src: "https://www.youtube.com/iframe_api" }));
    });
    const YT = await youTube;
    if (playerVideoId !== video.id) return; // Another round started while the script loaded

    const frame = $("videoFrame");
    const width = frame.clientWidth || 640;
    const height = frame.clientHeight || 360;
    const holder = document.createElement("div");
    $("playerSlot").replaceChildren(holder);
    const report = () => {
        if (!player?.getCurrentTime) return; // Not ready yet
        socket.emit("host:video", {
            videoId: playerVideoId, title: player.getVideoData()?.title ?? "",
            time: player.getCurrentTime(), playing: player.getPlayerState() === YT.PlayerState.PLAYING
        });
    };
    player = new YT.Player(holder, {
        videoId: video.id,
        width, height,
        host: "https://www.youtube-nocookie.com",
        playerVars: { start: Math.floor(videoSecondsNow()), playsinline: 1, rel: 0, origin: location.origin },
        events: {
            onReady: () => { scalePlayer(); applyQuality(); if (shareStream) cropShare(); report(); },
            onStateChange: event => {
                if (event.data === YT.PlayerState.PLAYING) applyQuality();
                report();
            },
            onError: event => {
                if (event.data === 2 || event.data === 100 || event.data === 101 || event.data === 150) {
                    videoFailed(socket, playerVideoId, event.data); // Not video.id: Change video loads other clips into this player
                }
            }
        }
    });
    reportTimer = setInterval(report, 1000);
}

function stopPlayer() {
    clearInterval(reportTimer);
    player?.destroy?.();
    player = null;
    playerVideoId = null;
    const slot = $("playerSlot");
    slot.replaceChildren();
    slot.style.cssText = "";
}

// Some videos aren't allowed to play outside YouTube (errors 101 and 150)
function videoFailed(socket, id, error) {
    playerFailedId = id;
    stopPlayer();
    playerFailedId = id; // stopPlayer clears the player, not the reason we stopped
    showHostMessage(error === 101 || error === 150
        ? "This video can't play in the page (the owner blocked embeds). Open it on YouTube and share that tab."
        : "This video can't be played here. Check the link, or open it on YouTube and share that tab.");
    $("hostYouTubeLink").href = `https://www.youtube.com/watch?v=${id}`;
    $("hostYouTubeLink").hidden = false;
}

async function startSharing(socket) {
    if (!navigator.mediaDevices?.getDisplayMedia) return;
    const { width, height } = playerSize();
    try {
        shareStream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: 30, height: { ideal: height }, width: { ideal: width } },
            audio: true,
            preferCurrentTab: true
        });
    } catch (e) {
        return showHostMessage("Sharing didn't start. Press Share video and pick this tab, with tab audio on.");
    }
    shareStream.getVideoTracks()[0].addEventListener("ended", () => stopSharing(socket)); // Chrome's own Stop sharing button
    await cropShare();
    socket.emit("stream:start");
    showSharing();
}

function stopSharing(socket) {
    shareStream?.getTracks().forEach(track => track.stop());
    shareStream = null;
    viewers.forEach(peer => peer.close());
    viewers.clear();
    socket.emit("stream:stop");
    showSharing();
}

// Viewers get only the player. restrictTo leaves host dialogs off the stream; cropTo is the older fallback
async function cropShare() {
    const track = shareStream?.getVideoTracks()[0];
    if (!track) return;
    const target = state.round.video ? $("playerSlot") : null;
    try {
        if (target && typeof RestrictionTarget !== "undefined" && track.restrictTo) {
            await track.restrictTo(await RestrictionTarget.fromElement(target));
            return;
        }
        await track.restrictTo?.(null);
    } catch (e) {}
    try {
        await track.cropTo(target ? await CropTarget.fromElement(target) : undefined);
    } catch (e) {} // Another tab was shared, or the browser can't crop: viewers see all of it
}

function chosenQuality() {
    return qualities[$("streamQuality")?.value] ?? qualities.auto;
}

function playerSize() {
    const { width, height } = chosenQuality();
    return { width, height };
}

function scalePlayer() {
    const slot = $("playerSlot");
    const frame = $("videoFrame");
    if (!slot || !player) return;
    slot.style.width = "100%";
    slot.style.height = "100%";
    slot.style.transform = "";
    player.setSize?.(frame.clientWidth || 640, frame.clientHeight || 360);
}

function applyQuality() {
    try {
        player?.setPlaybackQuality?.(chosenQuality().yt);
    } catch (e) {}
}

async function applyCaptureQuality() {
    const track = shareStream?.getVideoTracks()[0];
    if (!track) return;
    const { width, height } = playerSize();
    try {
        await track.applyConstraints({ frameRate: 30, height, width });
    } catch (e) {}
}

// A viewer asked for the stream: the host opens a connection just for them
async function sendStream(socket, viewerId) {
    dropViewer(viewerId);
    const peer = newPeer(socket, viewerId);
    viewers.set(viewerId, peer);
    shareStream.getTracks().forEach(track => peer.addTrack(track, shareStream));
    peer.addEventListener("connectionstatechange", () => {
        if (peer.connectionState === "failed") dropViewer(viewerId);
        showSharing();
    });
    await peer.setLocalDescription();
    socket.emit("rtc:signal", { to: viewerId, data: { sdp: peer.localDescription.toJSON() } });
}

function dropViewer(viewerId) {
    viewers.get(viewerId)?.close();
    viewers.delete(viewerId);
    showSharing();
}

function showSharing() {
    const watching = [...viewers.values()].filter(peer => peer.connectionState === "connected").length;
    $("shareButton").textContent = shareStream ? "Stop sharing" : "Share video";
    $("shareStatus").hidden = !shareStream;
    $("shareStatus").textContent = `● Live to ${watching} ${watching === 1 ? "person" : "people"}`;
}

// Viewers join the host's stream by themselves whenever there is one, including after joining late or a refresh
function watch(socket) {
    const from = state.streamFrom && state.streamFrom !== socket.id && !shareStream ? state.streamFrom : null;
    if (from === watchingFrom) return;
    watchPeer?.close();
    watchPeer = null;
    watchingFrom = from;
    showLive(socket, null);
    if (!from) return;

    const peer = watchPeer = newPeer(socket, from);
    peer.addEventListener("track", event => showLive(socket, event.streams[0]));
    peer.addEventListener("connectionstatechange", () => {
        if (peer !== watchPeer || peer.connectionState !== "failed") return;
        watchingFrom = null; // Try again in a moment
        setTimeout(() => watch(socket), 3000);
    });
    socket.emit("rtc:signal", { to: from, data: { type: "hello" } });
}

function showLive(socket, stream) {
    const video = $("liveVideo");
    if (stream === video.srcObject && !video.hidden === !!stream) return;
    video.srcObject = stream;
    video.hidden = !stream;
    $("streamControls").hidden = !stream;
    if (stream) {
        applyStreamVolume();
        video.play().catch(() => { // Sound needs a tap first, so start muted
            video.muted = true;
            video.play().catch(() => {});
            $("soundButton").hidden = false;
        });
    }
    $("soundButton").hidden = !stream || !video.muted;
    showVideo(socket);
}

function applyStreamVolume() {
    const video = $("liveVideo");
    const value = Number($("streamVolume").value);
    video.volume = value;
    if (value > 0) video.muted = false;
    $("soundButton").hidden = !video.srcObject || !video.muted;
    save("streamVolume", String(value));
}

function newPeer(socket, otherId) {
    const peer = new RTCPeerConnection({ iceServers });
    peer.addEventListener("icecandidate", event => {
        if (event.candidate) socket.emit("rtc:signal", { to: otherId, data: { candidate: event.candidate.toJSON() } });
    });
    return peer;
}

// Connection messages for one link are handled one at a time, in the order they came
function handleSignal(socket, peer, from, data) {
    peer.queue = (peer.queue ?? Promise.resolve()).then(async () => {
        if (data?.sdp) {
            await peer.setRemoteDescription(data.sdp);
            if (data.sdp.type === "offer") {
                await peer.setLocalDescription();
                socket.emit("rtc:signal", { to: from, data: { sdp: peer.localDescription.toJSON() } });
            }
        } else if (data?.candidate) {
            await peer.addIceCandidate(data.candidate);
        }
    }).catch(() => {}); // A message for a link that has since closed
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

function showMyWins(n) {
    $("myWins").textContent = n === 1 ? "🏆 1 win" : `🏆 ${n} wins`;
}

// The Leaderboard tile: the top five players and most spotted squares
async function showMiniBoard() {
    const { ok, data } = await api("GET", "/api/leaderboard");
    if (!ok) return;
    const none = text => el("li", "item empty", text);
    const players = data.players.slice(0, 5).map(player => playerRow(player, player.id === data.me?.id));
    const cards = data.cards.filter(card => card.rate !== null).slice(0, 5).map((card, i) => cardRow(card, i + 1));
    $("miniPlayers").replaceChildren(...(players.length ? players : [none("Nobody has a bingo yet.")]));
    $("miniCards").replaceChildren(...(cards.length ? cards : [none("Not enough games yet.")]));
}

function showMyCoins(n) {
    $("myCoins").textContent = n === 1 ? "🪙 1 coin" : `🪙 ${n} coins`;
}

// "+1" floating up out of the square a coin was earned on
function popCoins(cell, gained) {
    const pop = el("span", "coin-pop", `+${gained} 🪙`);
    cell.append(pop);
    setTimeout(() => pop.remove(), 900);
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
            Object.assign(el("span", "wins", `🏆 ${player.wins}`), { title: "Wins on their profile" })
        );
        return row;
    }));
}

function showFeed() {
    const items = [...state.events].reverse().map(event => {
        const still = event.type === "spot" ? event.userIds.filter(id => !(event.cleared ?? []).includes(id)) : null;
        const ids = event.type === "spot" ? (still.length ? still : event.userIds) : [event.userId];
        const names = listNames.format(ids.map(id => playerById(id).name));
        const text = el("span", "feed-text");
        if (event.type === "spot") text.append(`${names} spotted `, el("em", "", event.phrase));
        else if (event.type === "host") text.append(`👑 ${names} is now the host`);
        else if (event.type === "left") text.append(`👋 ${event.name} left the room`);
        else text.append(`🎉 ${names} got BINGO${event.lines > 1 ? ` (${event.lines} lines)` : ""}`);

        const avatars = el("span", "feed-avatars");
        avatars.append(...ids.map(id => avatar(event.type === "left" ? event : playerById(id))));
        const item = el("li", event.type === "win" ? "feed-item win" : "feed-item");
        if ((still && still.length === 0) || event.undone) item.classList.add("undone");
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
    return state.players.find(player => player.id === id) ?? departed.get(id) ?? { name: "Someone", avatar: "https://cdn.discordapp.com/embed/avatars/0.png" };
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

// The room ended or you left it: stop everything and say why
function leaveRoomView(socket, message) {
    stopPlayer();
    if (shareStream) stopSharing(socket);
    watchPeer?.close();
    watchPeer = null;
    socket.disconnect();
    arrange(false);
    $("roomGoneTitle").textContent = "Room closed";
    $("roomGoneText").textContent = message;
    $("roomMenu").hidden = true;
    show("roomGone");
}

function setMenuOpen(open) {
    setPanelOpen("account", open);
}

function setPanelOpen(name, open) {
    $(`${name}Panel`).hidden = !open;
    $(`${name}Button`).setAttribute("aria-expanded", open);
}

// Your picture (or the Room button) opens its menu; clicking elsewhere or pressing Escape closes it
function setUpMenu(name, wrapId) {
    $(`${name}Button`).addEventListener("click", () => setPanelOpen(name, $(`${name}Panel`).hidden));
    document.addEventListener("click", event => {
        // The path, not the target: the theme button redraws itself, so its clicked icon is gone by now
        if (!event.composedPath().includes($(wrapId))) setPanelOpen(name, false);
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") setPanelOpen(name, false);
    });
}

// First time on this device: pick light or dark and a colour. Anyone who already chose either skips it.
function welcome() {
    if (load("onboarded")) return;
    save("onboarded", "1");
    if (load("theme") || load("colour")) return;

    const themeButtons = [...$("themeChoice").querySelectorAll("button")];
    const showChoices = () => {
        const current = load("theme") ?? "system";
        themeButtons.forEach(button => button.setAttribute("aria-pressed", button.dataset.theme === current));
        $("welcomeSwatches").querySelectorAll(".swatch").forEach(swatch => swatch.setAttribute("aria-pressed", swatch.dataset.colour === $("colorPicker").value));
    };
    themeButtons.forEach(button => button.addEventListener("click", () => {
        setTheme(button.dataset.theme);
        showChoices();
    }));
    $("welcomeSwatches").replaceChildren(...Object.entries(presetColours).map(([colour, name]) => {
        const swatch = Object.assign(el("button", "swatch"), { type: "button", title: name });
        swatch.dataset.colour = colour;
        swatch.style.backgroundColor = colour;
        swatch.addEventListener("click", () => {
            pickColour(colour);
            showChoices();
        });
        return swatch;
    }));
    showChoices();
    $("onboarding").showModal();
}

// Suggested squares: anyone signed in can suggest one, with a description if it needs one. Admins review them on /admin
function setUpSuggestions() {
    const statusNames = { pending: "Waiting", approved: "Added ✓", rejected: "Not this time", removed: "Taken off" };
    const message = (id, text, ok) => {
        $(id).textContent = text;
        $(id).classList.toggle("error", !ok);
        $(id).hidden = !text;
    };

    // Every card, grouped by pack; hovering one shows its description
    const showPhrases = async () => {
        const { data } = await api("GET", "/api/cards");
        $("suggestPhrases").replaceChildren(...data.packs.flatMap(pack => {
            const cards = data.cards.filter(card => card.pack === pack.id);
            return cards.length ? [el("p", "phrase-pack", pack.name), ...cards.map(card =>
                Object.assign(el("span", card.description ? "phrase has-note" : "phrase", card.text), { title: card.description }))] : [];
        }));
    };
    const showMine = async () => {
        const { data } = await api("GET", "/api/suggestions");
        $("mySuggestions").replaceChildren(...(data.length ? data : [null]).map(s => {
            if (!s) return el("li", "item empty", "None yet.");
            const item = el("li", "item");
            item.append(el("span", "item-text", s.text), el("span", `item-status ${s.status}`, statusNames[s.status]));
            if (s.description) item.append(el("span", "item-note", s.description));
            return item;
        }));
    };
    $("suggestButton").addEventListener("click", async () => {
        setMenuOpen(false);
        message("suggestMessage", "", true);
        await Promise.all([showMine(), showPhrases()]);
        $("suggestDialog").showModal();
        $("suggestText").focus();
    });
    $("suggestForm").addEventListener("submit", async event => {
        event.preventDefault();
        const result = await api("POST", "/api/suggestions", { text: $("suggestText").value, description: $("suggestDescription").value });
        message("suggestMessage", result.ok ? "Thanks! It's waiting for approval." : result.data.error, result.ok);
        if (!result.ok) return;
        $("suggestText").value = $("suggestDescription").value = "";
        showMine();
    });

    if (!me.admin) return;
    $("manageLink").hidden = false;
    api("GET", "/api/admin/suggestions").then(({ data }) => { // The waiting count on the menu
        if (data.pending?.length) $("manageLabel").textContent = `Manage cards (${data.pending.length} waiting)`;
    });
}

// The packs and rerolls fields, used by the setup screen and by the host's Room settings
let packInfo = []; // Each pack with how many cards it holds

async function fillRoomOptions(chosen, rerolls) {
    const { data } = await api("GET", "/api/cards");
    packInfo = data.packs ?? [];
    $("packChoices").replaceChildren(...packInfo.map(pack => {
        const choice = el("label", "pack-choice");
        const box = Object.assign(document.createElement("input"), { type: "checkbox", value: pack.id, checked: chosen ? chosen.includes(pack.id) : pack.on });
        const words = el("span", "pack-words");
        words.append(el("strong", "", pack.name), el("span", "pack-count", `${pack.count} card${pack.count === 1 ? "" : "s"}`));
        if (pack.description) words.append(el("span", "pack-description", pack.description));
        choice.append(box, words);
        return choice;
    }));
    $("packChoices").onchange = showPackTotal;
    $("roomRerolls").value = String(rerolls);
    showPackTotal();
}

const chosenPacks = () => [...$("packChoices").querySelectorAll("input:checked")].map(box => box.value);

// A card has 24 squares, so Create room and Save wait until the ticked packs hold that many
function showPackTotal() {
    const total = packInfo.filter(pack => chosenPacks().includes(pack.id)).reduce((sum, pack) => sum + pack.count, 0);
    const enough = total >= 24;
    $("packTotal").textContent = enough ? `${total} cards to deal from` : `Only ${total} cards. Pick packs with at least 24.`;
    $("packTotal").classList.toggle("error", !enough);
    document.querySelectorAll(".needs-cards").forEach(button => button.disabled = !enough);
    return enough;
}

// Squares with a description show it at the pointer after a while: resting the mouse on one, or holding a finger on it.
// Long enough that it doesn't pop up while you move around the card
const tipDelayMs = 2000;

function setUpCardTips() {
    const card = $("bingoCard");
    const tip = $("cardTip");
    let timer = null;
    let start = null;          // Where a touch began, so moving it cancels the hold
    let mouse = null;          // Where the mouse is now, so the tip opens there after the wait
    let swallowClick = false;  // Lifting the finger after a hold isn't a tap
    const hide = () => {
        clearTimeout(timer);
        tip.hidden = true;
    };
    const showAt = (cell, x, y) => {
        tip.replaceChildren(el("strong", "", cell.querySelector(".cell-text").textContent), el("span", "", cell.dataset.note));
        tip.hidden = false;
        const { width, height } = tip.getBoundingClientRect();
        tip.style.left = `${Math.min(Math.max(8, x - width / 2), innerWidth - width - 8)}px`;
        tip.style.top = `${y - height - 14 < 8 ? y + 18 : y - height - 14}px`; // Above the pointer, or below near the top
    };

    card.addEventListener("pointerover", event => {
        const cell = event.target.closest(".has-note");
        if (event.pointerType !== "mouse" || !cell) return;
        clearTimeout(timer);
        mouse = { x: event.clientX, y: event.clientY };
        timer = setTimeout(() => showAt(cell, mouse.x, mouse.y), tipDelayMs);
    });
    card.addEventListener("pointermove", event => {
        if (event.pointerType === "mouse") {
            mouse = { x: event.clientX, y: event.clientY };
            const cell = event.target.closest(".has-note");
            if (cell && !tip.hidden) showAt(cell, mouse.x, mouse.y);
        } else if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
            clearTimeout(timer);
            start = null;
        }
    });
    card.addEventListener("pointerout", event => {
        if (event.pointerType === "mouse" && event.target.closest(".has-note")) hide();
    });
    card.addEventListener("pointerdown", event => {
        const cell = event.target.closest(".has-note");
        if (event.pointerType === "mouse" || !cell) return;
        start = { x: event.clientX, y: event.clientY };
        timer = setTimeout(() => {
            showAt(cell, start.x, start.y);
            swallowClick = true;
        }, tipDelayMs);
    });
    for (const type of ["pointerup", "pointercancel"]) {
        card.addEventListener(type, event => {
            if (event.pointerType === "mouse" || !start) return;
            clearTimeout(timer);
            start = null;
        });
    }
    // Capturing, so the square's own click (which marks it) never runs
    card.addEventListener("click", event => {
        if (!swallowClick) return;
        swallowClick = false;
        event.stopPropagation();
    }, true);
    // The next touch anywhere closes it
    document.addEventListener("pointerdown", event => {
        if (event.pointerType === "mouse" || tip.hidden) return;
        swallowClick = false;
        hide();
    }, true);
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
