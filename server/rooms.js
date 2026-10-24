// Rooms, rounds, cards, marks and wins. All held in memory, so a restart ends every room.
import { countLines, isOneAway } from "../docs/shared/lines.js";
import { recordProgress, sydneyHour } from "./achievements.js";
import { lookOf, reactionsOf, skinInfo, wornExtra } from "./shop.js";
import { addCoins, addWin, cardTable, cardsIn, coinSettings, coinsOf, countSpot, defaultPacks, earnCountCoin, getProfile, isBlocked, markDealt, packTable, removeWin, touchProfile, updateProfile } from "./store.js";

const codeLetters = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // No I, L, O, 0 or 1, which look alike
const maxRooms = 200; // shortcut: one cap for everyone stops endless room creation; add a per-person limit if it's ever opened up widely
const spotMergeMs = 30 * 1000;
const spotGapMs = 1000;
const reactGapMs = 300;
const maxReactions = 8; // Different emojis on one feed item
const emptyRoomMs = 6 * 60 * 60 * 1000;
const handoverMs = 60 * 1000;
const maxVideoSeconds = 10_000_000; // Room for long live streams
const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const rooms = new Map();
const maxCount = 99;
const keptRounds = 4; // Finished rounds the feed still shows, newest first
let roomsIo = null; // Kept so changes from the admin page reach rooms in progress

export function setupRooms(io) {
    roomsIo = io;
    io.on("connection", socket => {
        const user = socket.request.session.user;
        socket.data.userId = user.id;

        // The host can give the video when creating the room, so round 1 starts with it
        socket.on("room:create", (data, reply) => {
            if (typeof reply !== "function") return;
            if (isBlocked(user.id)) return reply({ error: "You can't host or join rooms right now." });
            if (rooms.size >= maxRooms) return reply({ error: "Too many rooms are open right now. Try again later." });
            let code;
            do code = Array.from({ length: 5 }, () => codeLetters[Math.floor(Math.random() * codeLetters.length)]).join("");
            while (rooms.has(code));
            const room = {
                code, hostId: user.id, players: new Map(), connections: new Map(), round: null, lastRound: null,
                nextEventId: 1, emptySince: Date.now(), hostAwaySince: null, streamSocket: null,
                rerolls: rerollsFrom(data?.rerolls) ?? 0,
                packs: packsFrom(data?.packs) ?? defaultPacks()
            };
            startRound(room, videoFrom(data));
            rooms.set(code, room);
            reply({ code });
        });

        socket.on("room:join", (data, reply) => {
            if (typeof reply !== "function") return;
            const room = rooms.get(String(data?.code).toUpperCase());
            if (!room) return reply({ error: "That room doesn't exist. It may have ended." });
            if (isBlocked(user.id)) return reply({ error: "You can't host or join rooms right now." });
            if (socket.data.code) return reply({ error: "Already in a room." });
            socket.data.code = room.code;
            socket.join(room.code);

            const wins = touchProfile(user).wins;
            const player = room.players.get(user.id) ?? { id: user.id, wins, lastSpotAt: 0, joinedAt: Date.now() };
            player.name = user.name;
            player.avatar = user.avatar;
            room.players.set(user.id, player);
            room.connections.set(user.id, (room.connections.get(user.id) ?? 0) + 1); // A second tab counts too
            if (user.id === room.hostId) room.hostAwaySince = null;
            room.emptySince = null;
            if (!room.round.cards.has(user.id)) room.round.cards.set(user.id, dealCard(room)); // Rejoining keeps your card
            checkHost(io, room); // The host may have been gone a while before anyone came back

            reply({ ok: true });
            socket.emit("room:state", stateFor(room, user.id));
            socket.to(room.code).emit("player:update", playerInfo(room, player));
        });

        // One more (or one fewer) sighting on a square; the reply says how many coins that earned
        socket.on("card:count", (data, reply) => {
            const room = rooms.get(socket.data.code);
            const { round, index, delta } = data ?? {};
            if (!room || round !== room.round.id || !Number.isInteger(index) || index < 0 || index > 24 || index === 12 || (delta !== 1 && delta !== -1)) return;
            const card = room.round.cards.get(user.id);
            const player = room.players.get(user.id);
            const change = applyCount(card, index, delta);
            if (!change) return;

            let gained = change.coin && coinsLeft(card) > 0 ? earnCountCoin(user.id) : 0;
            card.coinsEarned += gained;
            const phrase = card.phrases[index];
            countSpot(card.ids[index], change.marked ? 1 : change.unmarked ? -1 : 0, delta);
            const first = delta > 0 && spot(io, room, player, phrase); // Each sighting can show in the feed
            const moment = { count: change.count, marked: card.marked.size, hour: sydneyHour() };
            if (change.marked) {
                const lines = countLines(card.marked);
                if (lines > card.bestLines) {
                    const win = { type: "win", userId: user.id, lines };
                    if (card.bestLines === 0) { // One win per round, for the first line; kept on their profile
                        const { id, pieces } = wornExtra(getProfile(user.id) ?? {}, "celebration") ?? {};
                        if (id) win.celebration = { id, pieces };
                        player.wins = addWin(user.id);
                        const paid = payBingo(card);
                        addCoins(user.id, paid);
                        gained += paid;
                        moment.bingoMs = Date.now() - room.round.startedAt;
                    }
                    card.bestLines = lines;
                    addEvent(io, room, win);
                }
            } else if (change.unmarked) {
                unspot(io, room, player, card.phrases[index]);
                if (card.bestLines > 0 && countLines(card.marked) === 0) unwin(io, room, player, card);
            }
            const one = happened => happened ? 1 : 0;
            progress(io, room, user.id, {
                counts: one(delta > 0), takeBacks: one(delta < 0), firsts: one(first),
                swears: one(delta > 0 && /^says\b/i.test(phrase)), utes: one(delta > 0 && /\bute/i.test(phrase))
            }, moment);
            io.to(room.code).emit("player:update", playerInfo(room, player));
            if (typeof reply === "function") reply({ gained, coins: coinsOf(user.id) });
        });

        // An emoji on a feed item, or taking yours back off. Sent on its own so it doesn't look like a new sighting
        socket.on("event:react", data => {
            const room = rooms.get(socket.data.code);
            const player = room?.players.get(user.id);
            if (!player || Date.now() - (player.lastReactAt ?? 0) < reactGapMs) return;
            player.lastReactAt = Date.now();
            const event = room.round.events.find(e => e.id === data?.eventId);
            if (react(event, user.id, data?.emoji, reactionsOf(getProfile(user.id) ?? {}))) {
                io.to(room.code).emit("event:reactions", { id: event.id, reactions: event.reactions });
            }
        });

        // A new round, with the host's YouTube video if they gave one
        socket.on("host:newRound", async data => {
            const room = rooms.get(socket.data.code);
            if (!room || room.hostId !== user.id) return;
            // A round nobody has touched yet (like a new room's first) is replaced, keeping its number and skipping results
            const untouched = room.round.events.length === 0 && [...room.round.cards.values()].every(card => card.marked.size === 0);
            if (!untouched) {
                room.lastRound = roundSummary(room);
                for (const [id, card] of room.round.cards) if (card.bestLines === 0 && isOneAway(card.marked)) progress(io, room, id, { soClose: 1 });
                progress(io, room, user.id, { roundsHosted: 1 });
            }
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

        // Which packs the next cards come from; cards already dealt stay as they are
        socket.on("host:packs", data => {
            const room = rooms.get(socket.data.code);
            if (!room || room.hostId !== user.id) return;
            const packs = packsFrom(data?.packs);
            if (!packs) return;
            room.packs = packs;
            io.to(room.code).emit("packs:update", packs);
        });

        socket.on("card:reroll", data => {
            const room = rooms.get(socket.data.code);
            const card = room?.round.cards.get(user.id);
            if (!room || data?.round !== room.round.id || !canReroll(room, card)) return;
            room.round.cards.set(user.id, Object.assign(dealCard(room), { rerollsUsed: card.rerollsUsed + 1, coinsEarned: card.coinsEarned }));
            progress(io, room, user.id, { rerolls: 1 });
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
            if (room) removePlayer(io, room, user, "You left this room in another tab.", socket);
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

// Takes someone out of a room on every tab they have open (except the one that asked); a host who goes hands over straight away
function removePlayer(io, room, user, message, except = null) {
    if (io.sockets.sockets.get(room.streamSocket)?.data.userId === user.id) endStream(io, room);
    for (const other of io.sockets.sockets.values()) {
        if (other.data.code !== room.code || other.data.userId !== user.id) continue;
        other.data.code = null;
        other.leave(room.code);
        if (other !== except) other.emit("room:gone", message);
    }
    room.players.delete(user.id);
    room.connections.delete(user.id);
    room.round.cards.delete(user.id);
    if (room.players.size === 0) return rooms.delete(room.code);
    io.to(room.code).emit("player:left", user.id);
    addEvent(io, room, { type: "left", userId: user.id, name: user.name, avatar: user.avatar });
    if (room.hostId === user.id) {
        room.hostAwaySince = 0; // Counts as gone long enough
        checkHost(io, room);
    }
}

// An admin blocked someone: out of every room they're in
export function kickUser(userId) {
    for (const room of rooms.values()) {
        const player = room.players.get(userId);
        if (player) removePlayer(roomsIo, room, player, "An admin removed you from this room.");
    }
}

// An admin changed someone's wins, or they put on a frame or title: rooms they're in show it
export function refreshPlayer(userId) {
    for (const room of rooms.values()) {
        const player = room.players.get(userId);
        if (!player) continue;
        player.wins = getProfile(userId)?.wins ?? player.wins;
        roomsIo.to(room.code).emit("player:update", playerInfo(room, player));
    }
}

// The id changes every time, so marks meant for a replaced round can't land on the new cards
function startRound(room, video = null, replace = false) {
    video = continueVideo(room.round?.video, video); // Same dashcam clip, next bingo: keep watching from here
    const number = (room.round?.number ?? 0) + (replace ? 0 : 1);
    // The round that's ending stays in the feed under its number (a replaced round had nothing in it)
    if (room.round && !replace) room.pastRounds = [{ number: room.round.number, events: room.round.events }, ...(room.pastRounds ?? [])].slice(0, keptRounds);
    room.round = { id: (room.round?.id ?? 0) + 1, number, startedAt: Date.now(), video, cards: new Map(), events: [] };
    for (const id of room.players.keys()) room.round.cards.set(id, dealCard(room));
}

// 24 cards from the room's packs around FREE in the middle. The words are copied, so editing a card
// mid-round doesn't change squares people are looking at; each card counts as dealt for the stats
function dealCard(room) {
    const deck = cardsIn(room.packs);
    const picked = pickCards(deck.length >= 24 ? deck : cardTable.all()); // A pack was emptied or deleted mid-room
    markDealt(picked.map(card => card.id));
    picked.splice(12, 0, null);
    return {
        ids: picked.map(card => card?.id ?? null),
        phrases: picked.map(card => card?.text ?? "FREE"),
        notes: picked.map(card => card?.description ?? ""),
        counts: Array(25).fill(0), peak: Array(25).fill(0), marked: new Set(), bestLines: 0, rerollsUsed: 0,
        coinsEarned: 0, bingoPaid: 0
    };
}

// What a card can still earn this round; 0, not less, if an admin lowered the cap mid-round
export const coinsLeft = card => Math.max(0, coinSettings().coinsPerRound - card.coinsEarned);

// A BINGO pays what fits under the round's cap, kept so unwinning takes back exactly that
export function payBingo(card) {
    card.bingoPaid = Math.min(coinSettings().bingoCoins, coinsLeft(card));
    card.coinsEarned += card.bingoPaid;
    return card.bingoPaid;
}

export function refundBingo(card) {
    const paid = card.bingoPaid;
    card.coinsEarned -= paid;
    card.bingoPaid = 0;
    return paid;
}

// One more or one fewer sighting on a square (never below 0 or above 99). Says what changed: whether the square
// became marked or unmarked, and whether it's higher than it has been this round, which earns a coin, so
// taking one off and adding it back earns nothing more
export function applyCount(card, index, delta) {
    const before = card.counts[index];
    const count = Math.min(maxCount, Math.max(0, before + delta));
    if (count === before) return null;
    card.counts[index] = count;
    if (count > 0) card.marked.add(index);
    else card.marked.delete(index);
    const coin = count > card.peak[index];
    if (coin) card.peak[index] = count;
    return { count, marked: before === 0, unmarked: count === 0, coin };
}

// A third each from the most spotted, the middle and the least spotted cards, so every card gets a fair mix.
// Cards dealt fewer than 10 times go in at random places, since their numbers don't mean much yet
export function pickCards(cards, random = Math.random) {
    const ranked = cards.filter(card => card.dealt >= 10).sort((a, b) => b.spotted / b.dealt - a.spotted / a.dealt);
    for (const card of cards.filter(card => card.dealt < 10)) ranked.splice(Math.floor(random() * (ranked.length + 1)), 0, card);
    const third = Math.floor(ranked.length / 3);
    const tiers = [ranked.slice(0, third), ranked.slice(third, third * 2), ranked.slice(third * 2)];
    return shuffle(tiers.flatMap(tier => shuffle(tier, random).slice(0, 8)), random);
}

function shuffle(list, random = Math.random) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

// The packs a host picked, if they exist and hold enough cards to fill a card
export function packsFrom(value) {
    if (!Array.isArray(value)) return null;
    const ids = [...new Set(value)].filter(id => typeof id === "string" && packTable.get(id));
    return cardsIn(ids).length >= 24 ? ids : null;
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
    if (!recent) { // First in the room to spot it (lately), which counts towards Eagle eye
        addEvent(io, room, { type: "spot", phrase, userIds: [player.id], cleared: [] });
        return true;
    }
    const cleared = recent.cleared ?? [];
    if (recent.userIds.includes(player.id) && !cleared.includes(player.id)) return;
    recent.cleared = cleared.filter(id => id !== player.id);
    if (!recent.userIds.includes(player.id)) recent.userIds.push(player.id);
    io.to(room.code).emit("event", recent);
}

// Puts someone's emoji on a feed item (a spot, win or achievement), or takes it off if it's there. Returns whether
// anything changed
export function react(event, userId, emoji, allowed) {
    if (!["spot", "win", "achievement"].includes(event?.type) || !allowed.includes(emoji)) return false;
    const reactions = event.reactions ??= {};
    const who = reactions[emoji] ?? [];
    if (who.includes(userId)) {
        if (who.length === 1) delete reactions[emoji];
        else reactions[emoji] = who.filter(id => id !== userId);
    } else {
        if (!who.length && Object.keys(reactions).length >= maxReactions) return false;
        reactions[emoji] = [...who, userId];
    }
    return true;
}

// Adds to someone's lifetime stats, and tells them (with a pop-up) and the room (in the feed) about anything that unlocks
function progress(io, room, userId, changes, moment) {
    const { earned, coins } = updateProfile(userId, profile => ({ earned: recordProgress(profile, changes, moment), coins: profile.coins }));
    for (const a of earned) {
        addEvent(io, room, { type: "achievement", userId, name: a.name });
        for (const other of io.sockets.sockets.values()) {
            if (other.data.userId === userId && other.data.code === room.code) {
                other.emit("achievement", { name: a.name, description: a.description, coins: a.coins, total: coins });
            }
        }
    }
}

function unspot(io, room, player, phrase) {
    const event = room.round.events.findLast(e =>
        e.type === "spot" && e.phrase === phrase && e.userIds.includes(player.id) && !(e.cleared ?? []).includes(player.id));
    if (!event) return;
    event.cleared = [...(event.cleared ?? []), player.id];
    io.to(room.code).emit("event", event);
}

// Unmarking until no line is left takes back this round's BINGO and the win on their profile
function unwin(io, room, player, card) {
    player.wins = removeWin(player.id);
    addCoins(player.id, -refundBingo(card));
    card.bestLines = 0;
    for (const event of room.round.events) {
        if (event.type !== "win" || event.userId !== player.id || event.undone) continue;
        event.undone = true;
        io.to(room.code).emit("event", event);
    }
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
        id: player.id, name: player.name, avatar: player.avatar, wins: player.wins, ...lookOf(getProfile(player.id) ?? {}),
        connected: room.connections.get(player.id) > 0,
        marked: card ? card.marked.size : 0,
        oneAway: card ? isOneAway(card.marked) : false
    };
}

// Everything one player needs, including their own card (nobody else's)
function stateFor(room, userId) {
    const card = room.round.cards.get(userId);
    const profile = getProfile(userId) ?? {};
    return {
        code: room.code, hostId: room.hostId, rerolls: room.rerolls ?? 0, packs: room.packs,
        reactions: reactionsOf(profile), stamp: wornExtra(profile, "stamp")?.id ?? null, // Only you see your stamp
        round: { id: room.round.id, number: room.round.number, video: videoInfo(room.round.video) },
        lastRound: room.lastRound,
        streamFrom: room.streamSocket,
        players: [...room.players.values()].map(player => playerInfo(room, player)),
        events: room.round.events,
        pastRounds: room.pastRounds ?? [],
        // skins: your own equipped skin on each square (nobody else sees them)
        card: { ids: card.ids, skins: card.ids.map(id => id && skinInfo(profile.skins?.[id]?.equipped)), phrases: card.phrases, notes: card.notes, counts: card.counts, bestLines: card.bestLines, rerollsUsed: card.rerollsUsed ?? 0 }
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
export function roundSummary(room) {
    const firstWins = new Map();
    for (const event of room.round.events) if (event.type === "win" && !event.undone && !firstWins.has(event.userId)) firstWins.set(event.userId, event);
    const rows = [...room.players.values()].map(player => {
        const card = room.round.cards.get(player.id);
        const win = firstWins.get(player.id);
        const lines = card ? countLines(card.marked) : 0; // Lines still marked at the end, so an unmarked line doesn't count
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
