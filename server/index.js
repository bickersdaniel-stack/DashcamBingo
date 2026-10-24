// Together mode server: website files from docs/, Discord sign-in, and live updates over Socket.IO
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieSession from "cookie-session";
import { Server } from "socket.io";
import { auth, isAdmin } from "./auth.js";
import { cards } from "./cards.js";
import { cardsIn, defaultPacks, store } from "./store.js";
import { suggestions } from "./suggestions.js";
import { users } from "./users.js";
import { leaderboard } from "./leaderboard.js";
import { achievementRoutes } from "./achievements.js";
import { shop } from "./shop.js";
import { setupRooms } from "./rooms.js";

for (const key of ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "SESSION_SECRET", "PUBLIC_URL"]) {
    if (!process.env[key]) throw new Error(`${key} is missing. Copy .env.example to .env and fill it in.`);
}
const { SESSION_SECRET, PUBLIC_URL, PORT = 3000 } = process.env;
const docs = fileURLToPath(new URL("../docs", import.meta.url));
const version = Date.now().toString(36); // Changes every time the server starts

// A signed cookie holding who you are (cookie-session makes it httpOnly by default)
const session = cookieSession({
    name: "session",
    secret: SESSION_SECRET,
    secure: PUBLIC_URL.startsWith("https:"),
    sameSite: "lax",
    maxAge: 365 * 24 * 60 * 60 * 1000
});

const app = express();
app.set("trust proxy", 1); // Cloudflare Tunnel says the visit was over https, so secure cookies work
app.use(session);
app.use((req, res, next) => {
    // Remember signed-in people for a year from their latest visit: changing this once a day re-sends the cookie
    if (req.session.user) req.session.day = Math.floor(Date.now() / 86_400_000);
    next();
});
app.use(auth);
app.use(suggestions);
app.use(cards);
app.use(users);
app.use(leaderboard);
app.use(achievementRoutes);
app.use(shop);
app.get("/healthz", (req, res) => res.send("ok"));
// The solo game here deals from the packs that are on by default (or every card, if they hold too few for a card)
app.get("/phrases.txt", (req, res) => {
    const deck = cardsIn(defaultPacks());
    res.type("text").send((deck.length >= 24 ? deck : store.cards).map(card => card.text).join("\n"));
});
// Pages link their script and styles under /v/<version>/, so each deploy gets fresh copies
// (Cloudflare tells browsers to keep .js and .css for 4 hours, whatever this server says)
const page = file => async (req, res) => {
    const html = await readFile(`${docs}/${file}`, "utf8");
    res.type("html").send(html.replace(/(href|src)="\/?(styles\.css|room\.js|app\.js|admin\.js|leaderboard\.js|shop\.js|cards\.js|account\.js)"/g, `$1="/v/${version}/$2"`));
};
app.get(["/", "/r/:code"], page("room.html"));
app.get("/admin", (req, res, next) => isAdmin(req.session.user) ? next() : res.redirect("/"), page("admin.html"));
app.get("/leaderboard", page("leaderboard.html"));
app.get("/shop", page("shop.html"));
app.get("/cards", page("cards.html"));
app.get(["/solo", "/index.html"], page("index.html")); // The solo game, sharing this site's theme and colour
app.get("/privacy", page("privacy.html"));
const site = express.static(docs, { index: false }); // Only docs/ is public, never server code or .env
app.use("/v/:version", site);
app.use(site);

const server = createServer(app);
const io = new Server(server);
io.engine.use(session);
io.use((socket, next) => socket.request.session?.user ? next() : next(new Error("Sign in first")));
setupRooms(io);

server.listen(PORT, () => console.log(`Dashcam Bingo on port ${PORT}`));
