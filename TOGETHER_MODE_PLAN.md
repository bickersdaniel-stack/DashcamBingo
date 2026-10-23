# Dashcam Bingo: "Together mode" plan

## How to use this plan

This plan is written for a **new chat on the Linux server box**, which won't have the earlier conversation, so everything it needs is in here.

0. **(Done in the planning chat once this is approved)** This plan is saved into the repo as `TOGETHER_MODE_PLAN.md` and pushed, so it comes down with the clone. That's the only change made before the build starts.
1. Clone the repo on the server box:
   `git clone https://github.com/bickersdaniel-stack/DashcamBingo.git`
2. Start a chat in that folder and say: *"Follow TOGETHER_MODE_PLAN.md, starting at Phase 0. Check with me before pushing anything."*
3. Work through it **one phase at a time**. Each phase ends in something that works and can be tested.

Replace `bingo.example.com` everywhere with the real subdomain you pick.

---

## Context

### What exists today
- **Live site:** https://bickersdaniel-stack.github.io/DashcamBingo/, served by GitHub Pages from the `main` branch, repo root.
- **Repo:** https://github.com/bickersdaniel-stack/DashcamBingo. It's **public**, so secrets must never be committed.
- **Commit identity:** commits use the name `bickersdaniel-stack` and email `290347078+bickersdaniel-stack@users.noreply.github.com`, set for this repo only.
- **Old copy:** https://lord0fthetrains.github.io/DashcamBingo/ is an old version on an account the owner can't access any more. Ignore it.
- **No build step.** The site is three files:
  - `index.html`: all CSS inline, plus a small script in `<head>` that applies the saved theme before the page draws.
  - `app.js`: all the game logic.
  - `phrases.txt`: 80 Australian dashcam phrases, one per line. Each card uses 24 of them plus a FREE square.
- **Screenshot library:** html2canvas 1.4.1 from jsDelivr.
- **Font:** Plus Jakarta Sans from Google Fonts.

Behaviour that must keep working:
- **Theme button** cycles System, Light and Dark. The choice is stored in `localStorage["dashcamBingo.theme"]`, and the page always sets `data-theme="light|dark"` on `<html>`.
- **Colour menu:** 10 preset swatches, the last 5 colours used (`dashcamBingo.recentColours`, as JSON), and a custom picker. The current colour is in `dashcamBingo.colour`.
  - `setStampColour()` sets the CSS variables `--stamp`, `--stamp-text` (black or white, whichever is readable), `--stamp-glow` and `--stamp-ambient`.
- **Board:** a 5×5 grid of `<button>` squares.
  - FREE is index 12 and always marked.
  - Text size follows the board width using `cqi` units on `#bingoCardContainer`, so words never split, even on a 375px phone.
  - Rows are square and grow together.
- **Wins:** a screenshot (html2canvas of `#bingoCardContainer`, with the title shown only during capture) is taken only when a **new** line is completed (`bestLines`). It's added to "Your Winning Cards" with a number and time. Clicking it copies the image to the clipboard. A win does **not** copy automatically, and the owner said that's how it should stay.
- **Buttons:** Refresh Card (new card) and Clear Marks (unmark everything except FREE, same card). In the sidebar, Clear History empties the winning cards.
- **Layout:** the winning cards sidebar is on the right from 1024px wide up (320px, or 384px from 1280px), and stacked under the board below that. Phone tweaks kick in below 640px and 420px.
- **Look:** dark charcoal design with a matching light theme. All colours are CSS variables at the top of the stylesheet.

### How the group plays now
One person shares their screen in a Discord voice call with a YouTube dashcam video playing. Everyone watches the stream and plays bingo on their own copy of the site. Nobody can see anyone else's card.

### What we're building
A **logged-in "together" mode**, running on the owner's own Linux server at `https://bingo.example.com`:
- **Sign in with Discord.** Required, and only the Discord name and avatar are used.
- **Rooms.** Whoever creates a room is the **host**. Anyone with the room link can join after signing in.
- **Player list.** Shows each player's avatar and name, how many squares they've marked, a "1 away!" badge, and their win count.
- **Shared live feed.** "Sam spotted *Truck at fault* · 3:42" and "🎉 Dan got BINGO · 5:10".
  - When someone marks a phrase that's also on your card, that square briefly pulses on your card. You still tap it yourself.
- **Host plays the YouTube video inside the site.** This is option 2 from the planning chat. The host screen-shares that tab in Discord as usual, and other players don't need a video player at all.
  - Because the site knows where the video is up to, every feed event gets a video timestamp.
  - A new video starts a new round with fresh cards for everyone.
  - The host can click a feed item to replay that moment.
- **Scoreboard** for the room session.

The **public solo game on GitHub Pages stays exactly as it is now.** Together mode is extra, not a replacement.

### Decisions already made
- **Hosting:** the owner's Linux box, using Docker Compose with Cloudflare Tunnel, on a subdomain of a domain the owner has. No router or port changes.
- **Videos:** YouTube only, through the YouTube IFrame Player API.
- **Access:** anyone with the link, but Discord sign-in is required. No guests.
- **Two homes:** solo stays on GitHub Pages, and together mode runs on the server. They're one repo with shared front-end code.

---

## Architecture

```
Browser (host)  ──┐                         ┌── Discord OAuth (sign-in only)
Browser (player) ─┼─ https://bingo.example.com ── Cloudflare Tunnel ── server box:
Browser (player) ─┘   (HTTP + WebSocket)         docker compose: [app: Node 22] + [cloudflared]
```

- **Node 22**, with only three packages: **Express** (static files and sign-in routes), **Socket.IO** (live updates, reconnects and rooms) and **cookie-session** (a signed cookie holding the Discord id, name and avatar). Node 22 has `fetch` and `--env-file` built in.
- **The server is in charge of game state.** It deals cards, records marks, checks wins and stamps every event with the video time. Clients send what they did and draw what the server says.
- **State lives in memory.** That's fine for a friend group. A restart ends any rooms in progress, and everyone just rejoins. Saving state is optional, in Phase 5.
- **One set of rules.** The line-checking code is a single ES module used by both the browser and the server.

### Repo layout after the change
```
docs/                    ← GitHub Pages now publishes from /docs (see Phase 1)
  index.html             solo game (same look and behaviour as today)
  app.js                 solo glue: deals locally, Refresh/Clear, local wins
  room.html, room.js     together mode page and glue (sign-in, socket, players, feed, host video)
  styles.css             CSS moved out of index.html, shared by both pages
  core.js                shared browser code: theme, colour menu, storage helpers,
                         drawing the board, screenshots and winning cards
  shared/lines.js        WINNING_LINES + countLines(markedSet), used by browser AND server
  phrases.txt            single list of phrases (the server reads this too)
server/
  index.js               Express + Socket.IO, serves docs/ statically, sign-in routes
  auth.js                Discord OAuth
  rooms.js               rooms, rounds, cards, marks, wins, events
package.json             "type": "module", scripts: start, dev
Dockerfile, docker-compose.yml, .env.example, .gitignore (.env, node_modules)
TOGETHER_MODE_PLAN.md    this file
```
**Why `docs/`:** the server must only serve website files, never `server/`, `package.json` or `.env`. GitHub Pages can publish from either the repo root or a folder called `docs`, so moving the site into `docs/` keeps the github.io address and gives the server one safe folder to serve.

---

## Phases

### Phase 0: Owner setup (only the owner can do these; the chat can guide)
1. **Server box:** install Docker with the Compose plugin, git, and Node 22 for local testing. `gh` is optional, logged in as `bickersdaniel-stack`, so the chat can push.
2. **Cloudflare:** the domain's DNS must be on Cloudflare; the free plan is fine. In Zero Trust, go to Networks → Tunnels and create a tunnel, then copy its **token**. Add a public hostname `bingo.example.com` pointing to service `http://app:3000`.
3. **Discord:** at https://discord.com/developers/applications, create an application called "Dashcam Bingo". Under OAuth2, copy the **Client ID**, reset and copy the **Client Secret**, and add two redirects:
   - `https://bingo.example.com/auth/discord/callback`
   - `http://localhost:3000/auth/discord/callback` (for testing)
4. **Secrets:** put them in `.env` on the server, copied from `.env.example`. Never commit this file. It needs:
   - `DISCORD_CLIENT_ID`
   - `DISCORD_CLIENT_SECRET`
   - `SESSION_SECRET` (any long random string)
   - `PUBLIC_URL=https://bingo.example.com`
   - `PORT=3000`
   - `TUNNEL_TOKEN`
5. **Testing:** testing with more than one player needs **a second Discord account**, or a friend.

### Phase 1: Restructure, solo game unchanged
- Move the site files into `docs/`.
- Move the inline CSS into `docs/styles.css`.
- Split `app.js` so the shared parts can be reused:
  - **`core.js`** gets `load`/`save`, `showTheme`, `setStampColour`, `pickColour`/`showSwatches`/`makeSwatch`, `setCrossed`, drawing the board, `captureScreenshot`, `addWinningCard`, `showWinCount` and `copyToClipboard`.
  - **`shared/lines.js`** replaces `checkRows`/`checkColumns`/`checkDiagonals` with a `WINNING_LINES` list (12 lines) and `countLines()`.
  - **`app.js`** keeps only the solo glue: dealing cards, Refresh, Clear Marks and Clear History.
- Load the scripts as ES modules (`<script type="module">`). html2canvas stays a global from jsDelivr.
- Switch GitHub Pages to publish from `/docs`:
  `gh api -X PUT repos/bickersdaniel-stack/DashcamBingo/pages -f "source[branch]=main" -f "source[path]=/docs"`
- **Done when:** the github.io site looks and behaves exactly as before. Check it against the "Behaviour that must keep working" list above, and that all `localStorage` keys are unchanged.

### Phase 2: Server, Discord sign-in, deployed
- `server/index.js`:
  - `app.set('trust proxy', 1)`, because the app sits behind Cloudflare and secure cookies need this.
  - Serve `docs/` statically. Serve `/r/:code` as `room.html`. Add `/healthz`.
  - Cookie settings: `httpOnly`, `secure` in production, `sameSite: 'lax'`, signed with `SESSION_SECRET`.
- **Sign-in flow** in `server/auth.js`:
  - `GET /auth/discord` redirects to `https://discord.com/oauth2/authorize`, with `response_type=code`, `scope=identify` and a random `state` saved in the session.
  - `GET /auth/discord/callback` checks `state`, then POSTs a form to `https://discord.com/api/oauth2/token` (`grant_type=authorization_code`, plus code, redirect_uri, client id and secret).
  - It then calls `GET https://discord.com/api/users/@me` with the access token.
  - It saves `{ id, name: global_name ?? username, avatar }` in the session and **throws the token away**.
  - Avatar address: `https://cdn.discordapp.com/avatars/{id}/{avatar}.png?size=64`. If the user has no avatar, use `https://cdn.discordapp.com/embed/avatars/{(BigInt(id) >> 22n) % 6n}.png`.
  - `GET /api/me` returns the user or a 401. `POST /auth/logout` signs out.
- **Sockets:** `io.engine.use(sessionMiddleware)` lets Socket.IO read the same cookie. Reject connections without a signed-in user.
- **`room.html` without a room code:** shows a "Sign in with Discord" button. After sign-in, it shows "Create a room" or "Join with code". It reuses the top bar, theme and colour menu, plus an avatar and Sign out at the right.
- **Deploy:**
  - `Dockerfile`: `node:22-alpine`, `npm ci --omit=dev`, `node server/index.js`.
  - `docker-compose.yml`: an `app` service (env_file `.env`, `restart: unless-stopped`), and a `cloudflared` service (pinned `cloudflare/cloudflared` version, `tunnel --no-autoupdate run --token ${TUNNEL_TOKEN}`).
- **Done when:** https://bingo.example.com loads, Discord sign-in works, and the avatar and name show up.

### Phase 3: Rooms, players, live marking, wins (no video yet)
- **`server/rooms.js`, held in memory:**
  ```
  Room  { code, hostId, players: Map<userId,{id,name,avatar,connected,wins}>, round }
  Round { id, number, video: {id,title,time,playing,reportedAt} | null,
          cards: Map<userId,{phrases[25], marked:Set<index>, bestLines}>, events: [] }
  ```
- **Room codes:** 5 characters from an alphabet with no look-alike letters or numbers. A room is removed after 6 hours with nobody connected.
- **Joining:** joining with a code gives you a card, dealt by the server from `docs/phrases.txt` as 24 random phrases plus FREE at index 12. Reconnecting or opening a second tab gets the **same** card back.
- **Messages from the browser:**
  - `room:create`
  - `room:join {code}`
  - `card:mark {index, marked}` (index 0–24 and never 12, ignored if it's from an old round)
- **Messages from the server:**
  - `room:state` (everything, sent on join or reconnect, including your own card)
  - `player:update {id, marked, oneAway, wins, connected}`
  - `event:spot {userId, phrase, videoTime}`
  - `event:win {userId, lines, videoTime}`
  - `round:new`
- **Spotting:** when someone marks a square, everyone else gets `event:spot`.
  - If two people spot the same phrase within 30 seconds, it's one feed item with several avatars.
  - Each player is limited to 1 spot per second.
  - Unmarking a square doesn't send anything.
  - On your own card, a square that someone else just spotted pulses with their avatar for about 10 seconds if you haven't marked it.
- **Wins:** the server runs `countLines`. When a player's line count beats their `bestLines`, it sends `event:win` and adds 1 to their `wins` (once per round, on their first line). The browser still takes its own screenshot locally, using the same shared `countLines`.
- **Room page layout:**
  - The board in the centre, as now.
  - Above it: the room code and a "Copy invite link" button.
  - Sidebar tabs: **Players** (sorted by wins, with a crown for the host), **Feed**, and **Winning cards** (your own screenshots, as now).
  - The host also gets a "New round" button.
- **Done when:** two signed-in accounts in one room see each other, marks and spots appear live, wins show for both, and a refresh puts you back on the same card.

### Phase 4: The host plays the video in the site, with timestamps
- **Host view:** paste a YouTube link (it should understand the `watch?v=`, `youtu.be/`, `shorts/` and `&t=` forms) and press **Start round**.
  - This plays the video in a YouTube IFrame Player (`https://www.youtube.com/iframe_api`) and sends `round:new` with fresh cards for everyone.
  - Layout: the video large on the left, the host's own card on the right, the feed under the video. The host screen-shares this tab in Discord as before.
- **Video time:** while the video is playing, and also on play, pause and skip, the host sends `host:video {videoId, title: player.getVideoData().title, time, playing}` about once a second.
  - The server stamps each event with an **estimated** time: last reported time, plus time since that report if it's playing.
  - Players see "Now playing: *title* · 3:42" above their board. They don't get a video player.
- **Replay:** on the host's screen only, clicking a feed item jumps the video to 5 seconds before that moment.
- **Fallback:** if a video can't be played outside YouTube (player `onError` 101/150), show "This video can't play here. Play it on YouTube and share that tab instead". The round then runs on a round timer, and events are stamped with time since the round started.
- **Done when:** events carry correct video times, a new link starts a new round for everyone, and replay jumps to the right spot.

### Phase 5: Polish (pick what's wanted)
- **Host handover:** if the host is disconnected for more than 60 seconds, the longest-connected player becomes host.
- **Scoreboard** at the end of a round or session. Optionally keep an all-time leaderboard per Discord id in SQLite, stored in a Docker volume.
- **Same card for everyone:** a toggle for the host.
- **Discord channel posts:** wins posted to a channel through a Discord webhook. The webhook address is a secret and stays in `.env`.
- **"Play together" link:** a small link on the solo page that points to `bingo.example.com`. **Ask the owner first.**

---

## Security must-dos
- **No secrets in git.** `.env` stays out of the repo (it's in `.gitignore`), and `.env.example` holds placeholder values only. The repo is public.
- **Escape names and titles.** Discord names and video titles must always go in with `textContent`, never `innerHTML`. The current `addWinningCard` builds HTML from a template string, so change it to build the elements one by one wherever names or titles appear.
- **The server checks everything:** square indexes, the round id, that only the host can do host actions, and the spot rate limit.
- **Only serve `docs/`,** so server code and config are never sent to browsers.

## Verification
- **Phase 1:** run any static server in `docs/` and compare with the live site on desktop (1280px) and phone (375px). Check light, dark and system themes, the colour menu and its Recent row, a win with its screenshot, click-to-copy, Clear Marks and Clear History. After pushing, check the github.io address again.
- **Phases 2–4, locally:** run `npm run dev`, which is `node --env-file=.env --watch server/index.js`, and open http://localhost:3000.
  - Use a normal window plus a private window, signed in as two different Discord accounts.
  - Check: sign in and out, create and join by link, the player list, live spots with the pulse on matching squares, wins in both windows, refreshing to get the same card back, host-only controls, and the video timestamps and replay.
- **Deployed:** run `docker compose up -d --build`, visit https://bingo.example.com, and check that sign-in works over HTTPS. In the browser's developer tools, check that the WebSocket connects through the tunnel. Test on a phone too.
- **Before every push:** the owner checks the change in a local preview first, and nothing is pushed or deployed until they say so.

## Out of scope
- A Discord Activity version (dropped).
- Guests without Discord.
- Video sources other than YouTube.
- Syncing a video player for every viewer. The host's screen share does that job.
