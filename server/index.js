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
// The page links its script and styles under /v/<version>/, so each deploy gets fresh copies
// (Cloudflare tells browsers to keep .js and .css for 4 hours, whatever this server says)
app.get(["/", "/r/:code"], async (req, res) => {
    const page = await readFile(`${docs}/room.html`, "utf8");
    res.type("html").send(page.replace('"/styles.css"', `"/v/${version}/styles.css"`).replace('"/room.js"', `"/v/${version}/room.js"`));
});
app.use(["/v/:version", "/"], express.static(docs, { index: false })); // Only docs/ is public, never server code or .env

const server = createServer(app);
const io = new Server(server);
io.engine.use(session);
io.use((socket, next) => socket.request.session?.user ? next() : next(new Error("Sign in first")));
setupRooms(io);

server.listen(PORT, () => console.log(`Dashcam Bingo on port ${PORT}`));
