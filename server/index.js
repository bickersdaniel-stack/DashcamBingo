// Together mode server: website files from docs/, Discord sign-in, and live updates over Socket.IO
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieSession from "cookie-session";
import { Server } from "socket.io";
import { auth } from "./auth.js";
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
    maxAge: 30 * 24 * 60 * 60 * 1000
});

const app = express();
app.set("trust proxy", 1); // Cloudflare Tunnel says the visit was over https, so secure cookies work
app.use(session);
app.use(auth);
app.get("/healthz", (req, res) => res.send("ok"));
// Pages link their script and styles under /v/<version>/, so each deploy gets fresh copies
// (Cloudflare tells browsers to keep .js and .css for 4 hours, whatever this server says)
const page = file => async (req, res) => {
    const html = await readFile(`${docs}/${file}`, "utf8");
    res.type("html").send(html.replace(/(href|src)="\/?(styles\.css|room\.js|app\.js)"/g, `$1="/v/${version}/$2"`));
};
app.get(["/", "/r/:code"], page("room.html"));
app.get(["/solo", "/index.html"], page("index.html")); // The solo game, sharing this site's theme and colour
const site = express.static(docs, { index: false }); // Only docs/ is public, never server code or .env
app.use("/v/:version", site);
app.use(site);

const server = createServer(app);
const io = new Server(server);
io.engine.use(session);
io.use((socket, next) => socket.request.session?.user ? next() : next(new Error("Sign in first")));
setupRooms(io);

server.listen(PORT, () => console.log(`Dashcam Bingo on port ${PORT}`));
