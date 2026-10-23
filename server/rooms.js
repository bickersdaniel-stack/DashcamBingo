// Rooms, rounds, cards, marks and wins. All held in memory, so a restart ends every room.
import { readFileSync } from "node:fs";
import { countLines, isOneAway } from "../docs/shared/lines.js";

const phrases = readFileSync(new URL("../docs/phrases.txt", import.meta.url), "utf8")
    .split("\n").map(line => line.trim()).filter(line => line !== "");
const codeLetters = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // No I, L, O, 0 or 1, which look alike
const maxRooms = 200; // shortcut: one cap for everyone stops endless room creation; add a per-person limit if it's ever opened up widely
const spotMergeMs = 30 * 1000;
const spotGapMs = 1000;
const emptyRoomMs = 6 * 60 * 60 * 1000;
const rooms = new Map();

export function setupRooms(io) {
    io.on("connection", socket => {
        const user = socket.request.session.user;
        socket.data.userId = user.id;

        socket.on("room:create", reply => {
            if (typeof reply !== "function") return;
            if (rooms.size >= maxRooms) return reply({ error: "Too many rooms are open right now. Try again later." });
            let code;
            do code = Array.from({ length: 5 }, () => codeLetters[Math.floor(Math.random() * codeLetters.length)]).join("");
            while (rooms.has(code));
            const room = { code, hostId: user.id, players: new Map(), connections: new Map(), round: null, nextEventId: 1, emptySince: Date.now() };
            startRound(room);
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

            const player = room.players.get(user.id) ?? { id: user.id, wins: 0, lastSpotAt: 0 };
            player.name = user.name;
            player.avatar = user.avatar;
            room.players.set(user.id, player);
            room.connections.set(user.id, (room.connections.get(user.id) ?? 0) + 1); // A second tab counts too
            room.emptySince = null;
            if (!room.round.cards.has(user.id)) room.round.cards.set(user.id, dealCard()); // Rejoining keeps your card

            reply({ ok: true });
            socket.emit("room:state", stateFor(room, user.id));
            socket.to(room.code).emit("player:update", playerInfo(room, player));
        });

        socket.on("card:mark", data => {
            const room = rooms.get(socket.data.code);
            const { round, index, marked } = data ?? {};
            if (!room || round !== room.round.number || !Number.isInteger(index) || index < 0 || index > 24 || index === 12 || typeof marked !== "boolean") return;
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

        socket.on("host:newRound", async () => {
            const room = rooms.get(socket.data.code);
            if (!room || room.hostId !== user.id) return;
            startRound(room);
            for (const other of await io.in(room.code).fetchSockets()) other.emit("room:state", stateFor(room, other.data.userId));
        });

        socket.on("disconnect", () => {
            const room = rooms.get(socket.data.code);
            if (!room) return;
            const left = room.connections.get(user.id) - 1;
            room.connections.set(user.id, left);
            if (left === 0) io.to(room.code).emit("player:update", playerInfo(room, room.players.get(user.id)));
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

function startRound(room) {
    room.round = { number: (room.round?.number ?? 0) + 1, startedAt: Date.now(), cards: new Map(), events: [] };
    for (const id of room.players.keys()) room.round.cards.set(id, dealCard());
}

// 24 random phrases around FREE in the middle
function dealCard() {
    const deck = [...phrases];
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const cardPhrases = deck.slice(0, 25);
    cardPhrases[12] = "FREE";
    return { phrases: cardPhrases, marked: new Set(), bestLines: 0 };
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
    // Seconds into the round; Phase 4 swaps in the video's time when the host plays one
    Object.assign(event, { id: room.nextEventId++, at: now, videoTime: Math.floor((now - room.round.startedAt) / 1000) });
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
        code: room.code, hostId: room.hostId,
        round: { number: room.round.number },
        players: [...room.players.values()].map(player => playerInfo(room, player)),
        events: room.round.events,
        card: { phrases: card.phrases, marked: [...card.marked], bestLines: card.bestLines }
    };
}
