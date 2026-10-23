// Rooms, rounds, cards, marks and wins. All held in memory, so a restart ends every room.
import { countLines, isOneAway } from "../docs/shared/lines.js";
import { allPhrases } from "./store.js";

const codeLetters = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // No I, L, O, 0 or 1, which look alike
const maxRooms = 200; // shortcut: one cap for everyone stops endless room creation; add a per-person limit if it's ever opened up widely
const spotMergeMs = 30 * 1000;
const spotGapMs = 1000;
const emptyRoomMs = 6 * 60 * 60 * 1000;
const handoverMs = 60 * 1000;
const maxVideoSeconds = 10_000_000; // Room for long live streams
const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const rooms = new Map();

export function setupRooms(io) {
    io.on("connection", socket => {
        const user = socket.request.session.user;
        socket.data.userId = user.id;

        // The host can give the video when creating the room, so round 1 starts with it
        socket.on("room:create", (data, reply) => {
            if (typeof reply !== "function") return;
            if (rooms.size >= maxRooms) return reply({ error: "Too many rooms are open right now. Try again later." });
            let code;
            do code = Array.from({ length: 5 }, () => codeLetters[Math.floor(Math.random() * codeLetters.length)]).join("");
            while (rooms.has(code));
            const room = {
                code, hostId: user.id, players: new Map(), connections: new Map(), round: null, lastRound: null,
                nextEventId: 1, emptySince: Date.now(), hostAwaySince: null, streamSocket: null,
                rerolls: rerollsFrom(data?.rerolls) ?? 0
            };
            startRound(room, videoFrom(data));
            rooms.set(code, room);
            reply({ code });
        });

        socket.on("room:join", (data, reply) => {
            if (typeof reply !== "function") return;
            const room = rooms.get(String(data?.code).toUpperCase());
            if (!room) return reply({ error: "That room doesn't exist. It may have ended." });
            if (socket.data.code) return reply({ error: "Already in a room." });
            socket.data.code = room.code;
            socket.join(room.code);

            const player = room.players.get(user.id) ?? { id: user.id, wins: 0, lastSpotAt: 0, joinedAt: Date.now() };
            player.name = user.name;
            player.avatar = user.avatar;
            room.players.set(user.id, player);
            room.connections.set(user.id, (room.connections.get(user.id) ?? 0) + 1); // A second tab counts too
            if (user.id === room.hostId) room.hostAwaySince = null;
            room.emptySince = null;
            if (!room.round.cards.has(user.id)) room.round.cards.set(user.id, dealCard()); // Rejoining keeps your card
            checkHost(io, room); // The host may have been gone a while before anyone came back

            reply({ ok: true });
            socket.emit("room:state", stateFor(room, user.id));
            socket.to(room.code).emit("player:update", playerInfo(room, player));
        });

        socket.on("card:mark", data => {
            const room = rooms.get(socket.data.code);
            const { round, index, marked } = data ?? {};
            if (!room || round !== room.round.id || !Number.isInteger(index) || index < 0 || index > 24 || index === 12 || typeof marked !== "boolean") return;
            const card = room.round.cards.get(user.id);
            const player = room.players.get(user.id);
            if (card.marked.has(index) === marked) return;

            if (marked) {
                card.marked.add(index);
                spot(io, room, player, card.phrases[index]);
                const lines = countLines(card.marked);
                if (lines > card.bestLines) {
                    if (card.bestLines === 0) player.wins++; // One win per round, for the first line
                    card.bestLines = lines;
                    addEvent(io, room, { type: "win", userId: user.id, lines });
                }
            } else {
                card.marked.delete(index); // Unmarking isn't announced
            }
            io.to(room.code).emit("player:update", playerInfo(room, player));
        });

        // A new round, with the host's YouTube video if they gave one
        socket.on("host:newRound", async data => {
            const room = rooms.get(socket.data.code);
            if (!room || room.hostId !== user.id) return;
            // A round nobody has touched yet (like a new room's first) is replaced, keeping its number and skipping results
            const untouched = room.round.events.length === 0 && [...room.round.cards.values()].every(card => card.marked.size === 0);
            if (!untouched) room.lastRound = roundSummary(room);
            startRound(room, videoFrom(data), untouched);
            for (const other of await io.in(room.code).fetchSockets()) other.emit("room:state", stateFor(room, other.data.userId));
        });

        socket.on("host:rerolls", data => {
            const room = rooms.get(socket.data.code);
            if (!room || room.hostId !== user.id) return;
            const n = rerollsFrom(data?.rerolls);
            if (n === null) return;
            room.rerolls = n;
            io.to(room.code).emit("rerolls:update", n);
        });

        socket.on("card:reroll", data => {
            const room = rooms.get(socket.data.code);
            const card = room?.round.cards.get(user.id);
            if (!room || data?.round !== room.round.id || !canReroll(room, card)) return;
            room.round.cards.set(user.id, Object.assign(dealCard(), { rerollsUsed: card.rerollsUsed + 1 }));
            socket.emit("room:state", stateFor(room, user.id));
            io.to(room.code).emit("player:update", playerInfo(room, room.players.get(user.id)));
        });

        // Swap the YouTube video without dealing new cards
        socket.on("host:setVideo", data => {
            const room = rooms.get(socket.data.code);
            if (!room || room.hostId !== user.id) return;
            const video = videoFrom(data);
            if (!video) return;
            room.round.video = video;
            io.to(room.code).emit("video:update", videoInfo(video));
        });

        // The host's player says where it's up to, about once a second
        socket.on("host:video", data => {
            const room = rooms.get(socket.data.code);
            const video = room?.round.video;
            if (!video || room.hostId !== user.id || data?.videoId !== video.id) return;
            const { time, playing, title } = data;
            if (!Number.isFinite(time) || time < 0 || time > maxVideoSeconds || typeof playing !== "boolean") return;
            Object.assign(video, { time, playing, reportedAt: Date.now() });
            if (typeof title === "string") video.title = title.slice(0, 200);
            socket.to(room.code).emit("video:update", videoInfo(video));
        });

        // The video can't play in the site, so the round goes back to counting from its start
        socket.on("host:videoFailed", () => {
            const room = rooms.get(socket.data.code);
            if (!room?.round.video || room.hostId !== user.id) return;
            room.round.video = null;
            io.to(room.code).emit("video:update", null);
        });

        // Leaving takes you out of the room on every tab; a host who leaves hands over straight away
        socket.on("room:leave", reply => {
            const room = rooms.get(socket.data.code);
            if (!room) return typeof reply === "function" && reply();
            if (io.sockets.sockets.get(room.streamSocket)?.data.userId === user.id) endStream(io, room);
            for (const other of io.sockets.sockets.values()) {
                if (other.data.code !== room.code || other.data.userId !== user.id) continue;
                other.data.code = null;
                other.leave(room.code);
                if (other !== socket) other.emit("room:gone", "You left this room in another tab.");
            }
            room.players.delete(user.id);
            room.connections.delete(user.id);
            room.round.cards.delete(user.id);
            if (room.players.size === 0) rooms.delete(room.code);
            else {
                io.to(room.code).emit("player:left", user.id);
                addEvent(io, room, { type: "left", userId: user.id, name: user.name, avatar: user.avatar });
                if (room.hostId === user.id) {
                    room.hostAwaySince = 0; // Counts as gone long enough
                    checkHost(io, room);
                }
            }
            if (typeof reply === "function") reply();
        });

        // The host can end the room for everyone
        socket.on("room:end", reply => {
            const room = rooms.get(socket.data.code);
            if (!room || room.hostId !== user.id) return;
            for (const other of io.sockets.sockets.values()) {
                if (other.data.code !== room.code) continue;
                other.data.code = null;
                other.leave(room.code);
                if (other !== socket) other.emit("room:gone", "The host ended this room.");
            }
            rooms.delete(room.code);
            if (typeof reply === "function") reply();
        });

        // The host shares their video straight to each viewer's browser (WebRTC); this server only passes
        // the connection messages between them, and only between the streaming host and the others in the room
        socket.on("stream:start", () => {
            const room = rooms.get(socket.data.code);
            if (!room || room.hostId !== user.id) return;
            room.streamSocket = socket.id;
            socket.to(room.code).emit("stream:live", socket.id);
        });
        socket.on("stream:stop", () => {
            const room = rooms.get(socket.data.code);
            if (room?.streamSocket === socket.id) endStream(io, room);
        });
        socket.on("rtc:signal", data => {
            const room = rooms.get(socket.data.code);
            const target = io.sockets.sockets.get(data?.to);
            if (!room?.streamSocket || target?.data.code !== room.code || JSON.stringify(data.data ?? null).length > 20000) return;
            if (socket.id !== room.streamSocket && data.to !== room.streamSocket) return; // Viewers only talk to the host
            target.emit("rtc:signal", { from: socket.id, data: data.data });
        });

        socket.on("disconnect", () => {
            const room = rooms.get(socket.data.code);
            if (!room) return;
            if (room.streamSocket === socket.id) endStream(io, room);
            else if (room.streamSocket) io.to(room.streamSocket).emit("rtc:left", socket.id); // A viewer left
            const left = room.connections.get(user.id) - 1;
            room.connections.set(user.id, left);
            if (left === 0) io.to(room.code).emit("player:update", playerInfo(room, room.players.get(user.id)));
            if (left === 0 && user.id === room.hostId) {
                room.hostAwaySince = Date.now();
                setTimeout(() => checkHost(io, room), handoverMs + 100).unref();
            }
            if ([...room.connections.values()].every(count => count === 0)) room.emptySince = Date.now();
        });
    });

    // Rooms nobody has been in for 6 hours are removed
    setInterval(() => {
        for (const [code, room] of rooms) {
            if (room.emptySince && Date.now() - room.emptySince > emptyRoomMs) rooms.delete(code);
        }
    }, 10 * 60 * 1000).unref();
}

// The id changes every time, so marks meant for a replaced round can't land on the new cards
function startRound(room, video = null, replace = false) {
    video = continueVideo(room.round?.video, video); // Same dashcam clip, next bingo: keep watching from here
    const number = (room.round?.number ?? 0) + (replace ? 0 : 1);
    room.round = { id: (room.round?.id ?? 0) + 1, number, startedAt: Date.now(), video, cards: new Map(), events: [] };
    for (const id of room.players.keys()) room.round.cards.set(id, dealCard());
}

// 24 random phrases around FREE in the middle
function dealCard() {
    const deck = allPhrases(); // Including approved suggestions
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const cardPhrases = deck.slice(0, 25);
    cardPhrases[12] = "FREE";
    return { phrases: cardPhrases, marked: new Set(), bestLines: 0, rerollsUsed: 0 };
}

export function rerollsFrom(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n <= 9 ? n : null; // shortcut: cap 9 a round, raise if anyone wants more
}

export function canReroll(room, card) {
    return !!card && (room.rerolls ?? 0) > 0 && (card.rerollsUsed ?? 0) < room.rerolls && card.marked.size === 0 && card.bestLines === 0;
}

// "Sam spotted ...": people spotting the same phrase within 30 seconds share one feed item
function spot(io, room, player, phrase) {
    const now = Date.now();
    if (now - player.lastSpotAt < spotGapMs) return; // At most one spot a second each
    player.lastSpotAt = now;
    const recent = room.round.events.findLast(event => event.type === "spot" && event.phrase === phrase && now - event.at < spotMergeMs);
    if (!recent) return addEvent(io, room, { type: "spot", phrase, userIds: [player.id] });
    if (recent.userIds.includes(player.id)) return;
    recent.userIds.push(player.id);
    io.to(room.code).emit("event", recent);
}

function addEvent(io, room, event) {
    const now = Date.now();
    const video = room.round.video;
    // Where the host's video is up to, or seconds into the round when there's no video
    const seconds = video ? videoTimeNow(video) : (now - room.round.startedAt) / 1000;
    Object.assign(event, { id: room.nextEventId++, at: now, videoTime: Math.floor(seconds), videoId: video?.id ?? null });
    room.round.events.push(event);
    if (room.round.events.length > 200) room.round.events.shift();
    io.to(room.code).emit("event", event);
}

function playerInfo(room, player) {
    const card = room.round.cards.get(player.id);
    return {
        id: player.id, name: player.name, avatar: player.avatar, wins: player.wins,
        connected: room.connections.get(player.id) > 0,
        marked: card ? card.marked.size : 0,
        oneAway: card ? isOneAway(card.marked) : false
    };
}

// Everything one player needs, including their own card (nobody else's)
function stateFor(room, userId) {
    const card = room.round.cards.get(userId);
    return {
        code: room.code, hostId: room.hostId, rerolls: room.rerolls ?? 0,
        round: { id: room.round.id, number: room.round.number, video: videoInfo(room.round.video) },
        lastRound: room.lastRound,
        streamFrom: room.streamSocket,
        players: [...room.players.values()].map(player => playerInfo(room, player)),
        events: room.round.events,
        card: { phrases: card.phrases, marked: [...card.marked], bestLines: card.bestLines, rerollsUsed: card.rerollsUsed ?? 0 }
    };
}

// A guess at where the host's video is now: their last report, plus the time since if it was playing
function videoTimeNow(video) {
    return video.time + (video.playing ? (Date.now() - video.reportedAt) / 1000 : 0);
}

export function continueVideo(previous, next) {
    if (!next || previous?.id !== next.id) return next;
    return { ...next, title: previous.title || next.title, time: videoTimeNow(previous), playing: previous.playing, reportedAt: Date.now() };
}

function videoInfo(video) {
    return video && { id: video.id, title: video.title, time: videoTimeNow(video), playing: video.playing };
}

// After the host has been gone a minute, whoever here joined the room first takes over (a refresh doesn't reset that)
function checkHost(io, room) {
    if (room.hostAwaySince === null || Date.now() - room.hostAwaySince < handoverMs) return;
    const next = [...room.players.values()]
        .filter(player => player.id !== room.hostId && room.connections.get(player.id) > 0)
        .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (!next) return; // Nobody here yet; the next person to join takes over
    room.hostId = next.id;
    room.hostAwaySince = null;
    io.to(room.code).emit("room:host", room.hostId);
    addEvent(io, room, { type: "host", userId: next.id });
}

// The round that just ended, best first: BINGOs in the order they happened, then whoever was closest
function roundSummary(room) {
    const firstWins = new Map();
    for (const event of room.round.events) if (event.type === "win" && !firstWins.has(event.userId)) firstWins.set(event.userId, event);
    const rows = [...room.players.values()].map(player => {
        const card = room.round.cards.get(player.id);
        const win = firstWins.get(player.id);
        const lines = card?.bestLines ?? 0;
        return {
            id: player.id, name: player.name, avatar: player.avatar, wins: player.wins, lines,
            marked: card?.marked.size ?? 0, oneAway: card ? isOneAway(card.marked) : false, bingoAt: win?.videoTime ?? null,
            order: lines > 0 ? (win?.id ?? Number.MAX_SAFE_INTEGER) : Infinity // A win that fell out of the feed still beats no win
        };
    });
    return {
        number: room.round.number,
        videoTitle: room.round.video?.title || null,
        players: rows
            .filter(row => row.marked > 0 || room.connections.get(row.id) > 0) // Leave out people who weren't playing
            .sort((a, b) => (a.order - b.order) || (b.oneAway - a.oneAway) || (b.marked - a.marked))
            .map(({ order, ...row }) => row)
    };
}

function endStream(io, room) {
    room.streamSocket = null;
    io.to(room.code).emit("stream:live", null);
}

// The host's YouTube video for a new round, if they gave a valid one
function videoFrom(data) {
    if (!videoIdPattern.test(data?.videoId)) return null;
    const start = Number.isFinite(data.start) ? Math.min(Math.max(data.start, 0), maxVideoSeconds) : 0;
    return { id: data.videoId, title: "", time: start, playing: false, reportedAt: Date.now() };
}
