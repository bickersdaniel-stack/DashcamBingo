// Sign in with Discord. Only the id, name and avatar are kept; the access token is thrown away.
import { randomBytes } from "node:crypto";
import { Router } from "express";

const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, PUBLIC_URL } = process.env;
const redirectUri = `${PUBLIC_URL}/auth/discord/callback`;

export const auth = Router();

auth.get("/auth/discord", (req, res) => {
    req.session.state = randomBytes(16).toString("hex"); // Proves the callback came from this sign-in
    req.session.next = /^\/r\/[A-Z0-9]{5}$/.test(req.query.next) ? req.query.next : undefined; // Back to the room link, never another site
    const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID, response_type: "code", scope: "identify", redirect_uri: redirectUri, state: req.session.state
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

auth.get("/auth/discord/callback", async (req, res) => {
    const { code, state } = req.query;
    const expected = req.session.state;
    const next = req.session.next ?? "/";
    delete req.session.state;
    delete req.session.next;
    if (!code) return res.redirect(next); // Pressed Cancel on Discord
    if (!expected || state !== expected) return res.status(400).send("Sign-in expired. Go back and try again.");

    try {
        const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
            method: "POST",
            body: new URLSearchParams({
                grant_type: "authorization_code", code, redirect_uri: redirectUri,
                client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET
            })
        });
        if (!tokenResponse.ok) throw new Error(`Discord token request failed: ${tokenResponse.status}`);
        const { access_token } = await tokenResponse.json();

        const meResponse = await fetch("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${access_token}` } });
        if (!meResponse.ok) throw new Error(`Discord user request failed: ${meResponse.status}`);
        const me = await meResponse.json();

        req.session.user = { id: me.id, name: me.global_name ?? me.username, avatar: avatarUrl(me) };
        res.redirect(next);
    } catch (error) {
        console.error(error);
        res.status(502).send("Couldn't sign in with Discord. Go back and try again.");
    }
});

auth.get("/api/me", (req, res) => {
    if (req.session.user) res.json(req.session.user);
    else res.sendStatus(401);
});

auth.post("/auth/logout", (req, res) => {
    req.session = null;
    res.redirect("/");
});

// Users without their own picture get one of Discord's default avatars
function avatarUrl({ id, avatar }) {
    return avatar
        ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=64`
        : `https://cdn.discordapp.com/embed/avatars/${(BigInt(id) >> 22n) % 6n}.png`;
}
