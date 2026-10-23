// Reads the video id and start time out of the usual YouTube link shapes: youtube.com/watch?v=ID&t=1m30s,
// youtu.be/ID?t=90, youtube.com/shorts/ID, /embed/ID and /live/ID, or a bare 11-character id
export function parseYouTubeLink(text) {
    text = text.trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(text)) return { id: text, start: 0 };
    let url;
    try { url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); } catch (e) { return null; }

    const host = url.hostname.replace(/^(www|m|music)\./, "");
    let id = null;
    if (host === "youtu.be") id = url.pathname.split("/")[1];
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
        id = url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/]+)/)?.[1];
    }
    if (!/^[A-Za-z0-9_-]{11}$/.test(id ?? "")) return null;
    return { id, start: parseTime(url.searchParams.get("t") ?? url.searchParams.get("start") ?? url.hash.match(/t=([^&]+)/)?.[1]) };
}

// "90", "90s", "1m30s" or "1h2m3s" as seconds
function parseTime(t) {
    if (!t) return 0;
    if (/^\d+s?$/.test(t)) return parseInt(t, 10);
    const parts = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    return parts ? (Number(parts[1] ?? 0) * 3600) + (Number(parts[2] ?? 0) * 60) + Number(parts[3] ?? 0) : 0;
}
