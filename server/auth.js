// Signing in: with Discord, with Google, or with a link sent by email. Only an id, a name and a picture
// are kept; access tokens are thrown away and email addresses are never shown to other players.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import express, { Router } from "express";

const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, RESEND_API_KEY, PUBLIC_URL, SESSION_SECRET } = process.env;
const EMAIL_FROM = process.env.EMAIL_FROM || "Dashcam Bingo <bingo@dkb.lol>";
const adminIds = (process.env.ADMIN_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean);
const discordRedirect = `${PUBLIC_URL}/auth/discord/callback`;
const googleRedirect = `${PUBLIC_URL}/auth/google/callback`;
const linkMinutes = 15;

export const auth = Router();
export const isAdmin = user => !!user && adminIds.includes(user.id);

auth.get("/api/me", (req, res) => {
    if (req.session.user) return res.json({ ...req.session.user, admin: isAdmin(req.session.user) });
    res.status(401).json({ google: !!GOOGLE_CLIENT_ID, email: !!RESEND_API_KEY }); // Which ways to sign in are set up
});

auth.post("/auth/logout", (req, res) => {
    req.session = null;
    res.redirect("/");
});

// Discord

auth.get("/auth/discord", (req, res) => {
    startSignIn(req, req.query.next);
    req.session.asked = req.query.ask === "1";
    const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID, response_type: "code", scope: "identify", redirect_uri: discordRedirect, state: req.session.state,
        // Skip Discord's approve screen for anyone who already approved this app; a retry shows it
        prompt: req.session.asked ? "consent" : "none"
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

auth.get("/auth/discord/callback", async (req, res) => {
    const asked = req.session.asked;
    delete req.session.asked;
    const { expected, next } = takeSignIn(req);
    if (!req.query.code) {
        // Discord's docs don't say how skipping the approve screen goes for someone who never approved the app,
        // so any error from a quiet try gets one retry that asks properly
        if (!asked) return res.redirect(`/auth/discord?ask=1${next === "/" ? "" : `&next=${next}`}`);
        return res.redirect(next); // Pressed Cancel on Discord
    }
    if (!expected || req.query.state !== expected) return res.status(400).send("Sign-in expired. Go back and try again.");
    try {
        const token = await postForm("https://discord.com/api/oauth2/token", {
            grant_type: "authorization_code", code: req.query.code, redirect_uri: discordRedirect,
            client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET
        });
        const me = await getJson("https://discord.com/api/users/@me", token.access_token);
        // Players without their own picture get one of Discord's default avatars
        const avatar = me.avatar
            ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64`
            : `https://cdn.discordapp.com/embed/avatars/${(BigInt(me.id) >> 22n) % 6n}.png`;
        req.session.user = { id: me.id, name: me.global_name ?? me.username, avatar };
        res.redirect(next);
    } catch (error) {
        console.error(error);
        res.status(502).send("Couldn't sign in with Discord. Go back and try again.");
    }
});

// Google

auth.get("/auth/google", (req, res) => {
    if (!GOOGLE_CLIENT_ID) return res.redirect("/");
    startSignIn(req, req.query.next);
    const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID, response_type: "code", scope: "openid profile", redirect_uri: googleRedirect, state: req.session.state
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

auth.get("/auth/google/callback", async (req, res) => {
    const { expected, next } = takeSignIn(req);
    if (!req.query.code) return res.redirect(next); // Pressed Cancel on Google
    if (!expected || req.query.state !== expected) return res.status(400).send("Sign-in expired. Go back and try again.");
    try {
        const token = await postForm("https://oauth2.googleapis.com/token", {
            grant_type: "authorization_code", code: req.query.code, redirect_uri: googleRedirect,
            client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET
        });
        const me = await getJson("https://openidconnect.googleapis.com/v1/userinfo", token.access_token);
        const name = (me.name || me.given_name || "Google player").slice(0, 32);
        req.session.user = { id: `google:${me.sub}`, name, avatar: me.picture || initialAvatar(name, me.sub) };
        res.redirect(next);
    } catch (error) {
        console.error(error);
        res.status(502).send("Couldn't sign in with Google. Go back and try again.");
    }
});

// Email: a one-off link that works for 15 minutes

auth.post("/auth/email", express.json({ limit: "2kb" }), async (req, res) => {
    if (!RESEND_API_KEY) return res.status(404).json({ error: "Email sign-in isn't set up." });
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const name = cleanName(req.body?.name);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return res.status(400).json({ error: "That email address doesn't look right." });
    if (!name) return res.status(400).json({ error: "Add the name other players will see." });
    // Stop anyone using the site to flood an inbox, or to send lots of mail at all
    if (tooMany(`ip:${req.ip}`, 5, 15 * 60_000) || tooMany(`email:${email}`, 3, 15 * 60_000) || tooMany("all", 100, 60 * 60_000)) {
        return res.status(429).json({ error: "Too many sign-in emails. Try again in a few minutes." });
    }
    const next = /^\/r\/[A-Z0-9]{5}$/.test(req.body?.next) ? req.body.next : "/";
    const token = signToken({ email, name, next, expires: Date.now() + linkMinutes * 60_000 });
    try {
        await sendSignInEmail(email, name, `${PUBLIC_URL}/auth/email/finish?token=${token}`);
        res.json({ ok: true });
    } catch (error) {
        console.error(error);
        res.status(502).json({ error: "Couldn't send the email. Try again in a minute." });
    }
});

// The link opens a page with a button rather than signing in straight away: email scanners open links
// by themselves, and would otherwise use up the link before the person gets to it
auth.get("/auth/email/finish", (req, res) => {
    const data = readToken(req.query.token);
    if (!data) return res.status(400).type("html").send(messagePage("This link has expired", "Sign-in links work once, for 15 minutes. Ask for a new one.", "/", "Back to start"));
    res.type("html").send(page("Finish signing in", `
        <h2>G'day, ${escapeHtml(data.name)}</h2>
        <p>Tap below to finish signing in to Dashcam Bingo.</p>
        <form method="post" action="/auth/email/finish">
            <input type="hidden" name="token" value="${escapeHtml(req.query.token)}">
            <button class="btn btn-primary" type="submit">Sign in</button>
        </form>`));
});

const usedLinks = new Map(); // Signature -> expiry, so each link works once
auth.post("/auth/email/finish", express.urlencoded({ extended: false, limit: "2kb" }), (req, res) => {
    const token = String(req.body?.token ?? "");
    const data = readToken(token);
    const signature = token.split(".")[1];
    if (!data || usedLinks.has(signature)) return res.status(400).type("html").send(messagePage("This link has expired", "Sign-in links work once, for 15 minutes. Ask for a new one.", "/", "Back to start"));
    usedLinks.set(signature, data.expires);
    // The id comes from the address but can't be turned back into it, so other players never see emails
    const id = `email:${createHash("sha256").update(data.email).digest("hex").slice(0, 24)}`;
    req.session.user = { id, name: data.name, avatar: initialAvatar(data.name, id) };
    res.redirect(data.next);
});

// Remembers where to go back to (only ever a room link on this site) and proves the reply belongs to this sign-in
function startSignIn(req, next) {
    req.session.state = randomBytes(16).toString("hex");
    req.session.next = /^\/r\/[A-Z0-9]{5}$/.test(next) ? next : undefined;
}

function takeSignIn(req) {
    const signIn = { expected: req.session.state, next: req.session.next ?? "/" };
    delete req.session.state;
    delete req.session.next;
    return signIn;
}

async function postForm(url, fields) {
    const response = await fetch(url, { method: "POST", body: new URLSearchParams(fields) });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return response.json();
}

async function getJson(url, accessToken) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return response.json();
}

async function sendSignInEmail(to, name, link) {
    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            from: EMAIL_FROM, to: [to], subject: "Your Dashcam Bingo sign-in link",
            text: `G'day ${name},\n\nOpen this link to sign in to Dashcam Bingo:\n${link}\n\nIt works once, for ${linkMinutes} minutes. If you didn't ask for it, you can ignore this email.`,
            html: `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:auto;padding:24px;color:#0f172a">
                <h2 style="margin:0 0 12px">G'day ${escapeHtml(name)}</h2>
                <p style="margin:0 0 20px;color:#475569">Tap the button to sign in to Dashcam Bingo.</p>
                <p style="margin:0 0 20px"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 22px;border-radius:8px;background:#22c55e;color:#0b0d10;font-weight:700;text-decoration:none">Sign in</a></p>
                <p style="margin:0;font-size:13px;color:#64748b">It works once, for ${linkMinutes} minutes. If you didn't ask for it, you can ignore this email.</p></div>`
        })
    });
    if (!response.ok) throw new Error(`Resend answered ${response.status}: ${await response.text()}`);
}

// Sign-in links carry the details themselves, signed so they can't be changed or made up
const linkKey = createHash("sha256").update(`${SESSION_SECRET}:email-link`).digest();
const mac = body => createHmac("sha256", linkKey).update(body).digest("base64url");

function signToken(data) {
    const body = Buffer.from(JSON.stringify(data)).toString("base64url");
    return `${body}.${mac(body)}`;
}

function readToken(token) {
    const [body, signature] = String(token ?? "").split(".");
    if (!body || !signature) return null;
    const expected = Buffer.from(mac(body));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
        const data = JSON.parse(Buffer.from(body, "base64url").toString());
        return data.expires > Date.now() ? data : null;
    } catch (error) {
        return null;
    }
}

// Counts attempts per key over a time window; true once there are more than allowed
const attempts = new Map();
function tooMany(key, max, windowMs) {
    const now = Date.now();
    const recent = (attempts.get(key) ?? []).filter(time => now - time < windowMs);
    recent.push(now);
    attempts.set(key, recent);
    return recent.length > max;
}

setInterval(() => {
    const now = Date.now();
    for (const [key, times] of attempts) if (times.every(time => now - time > 60 * 60_000)) attempts.delete(key);
    for (const [signature, expires] of usedLinks) if (expires < now) usedLinks.delete(signature);
}, 10 * 60_000).unref();

function cleanName(value) {
    return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 32);
}

// A coloured circle with the first letter, for players without a picture of their own
function initialAvatar(name, seed) {
    const hue = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 4), 16) % 360;
    const letter = escapeHtml(([...name][0] ?? "?").toUpperCase());
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='hsl(${hue} 55% 45%)'/>`
        + `<text x='32' y='43' font-family='sans-serif' font-size='30' font-weight='700' text-anchor='middle' fill='white'>${letter}</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function page(title, body) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} · Dashcam Bingo</title>
<script>try{const t=localStorage.getItem("dashcamBingo.theme");document.documentElement.dataset.theme=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light";const c=localStorage.getItem("dashcamBingo.colour");if(/^#[0-9a-f]{6}$/.test(c))document.documentElement.style.setProperty("--stamp",c)}catch(e){}</script>
<link rel="stylesheet" href="/styles.css"></head>
<body><main class="layout"><section class="stage"><div class="lobby">${body}</div></section></main></body></html>`;
}

function messagePage(title, text, href, label) {
    return page(title, `<h2>${title}</h2><p>${text}</p><a class="btn" href="${href}">${label}</a>`);
}
