// Shared by the solo game and together mode: the top bar (theme and colour menu), saved settings,
// drawing the board, and screenshots of winning cards. Importing this sets up the top bar and sidebar.
const bingoCard = document.getElementById("bingoCard");
const gallery = document.getElementById("gallery");
const emptyState = document.getElementById("emptyState");
const winCountLabel = document.getElementById("winCount");
const colorPicker = document.getElementById("colorPicker");
const colourCode = document.getElementById("colourCode");
const colourButton = document.getElementById("colourButton");
const colourPopover = document.getElementById("colourPopover");
const presetSwatches = document.getElementById("presetSwatches");
const recentSection = document.getElementById("recentSection");
const recentSwatches = document.getElementById("recentSwatches");
const themeButton = document.getElementById("themeButton");
let winCount = 0;

// Theme button cycles System -> Light -> Dark, remembered on this device
const themes = ["system", "light", "dark"];
const themeNames = { system: "System", light: "Light", dark: "Dark" };
const themeIcons = {
    system: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
    light: "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z",
    dark: "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
};
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
let theme = themes.includes(load("theme")) ? load("theme") : "system";
showTheme();
darkQuery.addEventListener("change", showTheme); // Follow the device when it switches, if on System

themeButton.addEventListener("click", () => setTheme(themes[(themes.indexOf(theme) + 1) % themes.length]));

export function setTheme(name) {
    theme = name;
    save("theme", theme);
    showTheme();
}

// Colour menu: preset colours, the last 5 picked on this device, and a custom picker.
// The room page shows the swatches inside its account menu, so there's no colour button or pop-up there.
export const presetColours = {
    "#22c55e": "Green", "#14b8a6": "Teal", "#06b6d4": "Cyan", "#3b82f6": "Blue", "#6366f1": "Indigo",
    "#a855f7": "Purple", "#ec4899": "Pink", "#ef4444": "Red", "#f97316": "Orange", "#eab308": "Yellow"
};
const isHex = value => /^#[0-9a-f]{6}$/.test(value);
let recentColours = [];
try { recentColours = JSON.parse(load("recentColours")).filter(isHex).slice(0, 5); } catch (e) {}

// Use the colour picked last time on this device
const savedColour = load("colour");
if (isHex(savedColour)) colorPicker.value = savedColour;
setStampColour(colorPicker.value);
showSwatches();

colourButton?.addEventListener("click", () => setColourMenuOpen(colourPopover.hidden));

// Close the menu when clicking elsewhere or pressing Escape
document.addEventListener("click", (event) => {
    if (!event.target.closest(".colour-menu")) setColourMenuOpen(false);
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setColourMenuOpen(false);
});

// Custom colour previews live while dragging, and is kept once the picker closes
colorPicker.addEventListener("input", (event) => setStampColour(event.target.value));
colorPicker.addEventListener("change", (event) => {
    pickColour(event.target.value);
    setColourMenuOpen(false);
});

document.getElementById("clearHistoryButton")?.addEventListener("click", () => {
    gallery.querySelectorAll(".win-card").forEach(card => {
        URL.revokeObjectURL(card.querySelector("img").src);
        card.remove();
    });
    winCount = 0;
    showWinCount();
});

function setColourMenuOpen(open) {
    if (!colourPopover) return;
    colourPopover.hidden = !open;
    colourButton.setAttribute("aria-expanded", open);
}

export function pickColour(colour) {
    colorPicker.value = colour;
    setStampColour(colour);
    save("colour", colour);
    recentColours = [colour, ...recentColours.filter(c => c !== colour)].slice(0, 5);
    save("recentColours", JSON.stringify(recentColours));
    showSwatches();
}

function showSwatches() {
    presetSwatches.replaceChildren(...Object.keys(presetColours).map(makeSwatch));
    recentSwatches.replaceChildren(...recentColours.map(makeSwatch));
    recentSection.hidden = recentColours.length === 0;
}

function makeSwatch(colour) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "swatch";
    swatch.style.backgroundColor = colour;
    swatch.title = presetColours[colour] || colour.toUpperCase();
    swatch.setAttribute("aria-pressed", colour === colorPicker.value);
    swatch.addEventListener("click", () => {
        pickColour(colour);
        setColourMenuOpen(false);
    });
    return swatch;
}

function showTheme() {
    const dark = theme === "dark" || (theme === "system" && darkQuery.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    themeButton.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${themeIcons[theme]}"/></svg>`
        + `<span class="theme-label">${themeNames[theme]}</span><span class="status-dot"></span>`;
    themeButton.setAttribute("aria-label", `Theme: ${themeNames[theme]}`);
}

// Saved settings live in this browser only; ignore errors if storage is blocked
export function load(key) {
    try { return localStorage.getItem("dashcamBingo." + key); } catch (e) { return null; }
}

export function save(key, value) {
    try { localStorage.setItem("dashcamBingo." + key, value); } catch (e) {}
}

// Marked squares, the glow and the colour pill all read these CSS variables
function setStampColour(colour) {
    const r = parseInt(colour.slice(1, 3), 16);
    const g = parseInt(colour.slice(3, 5), 16);
    const b = parseInt(colour.slice(5, 7), 16);
    const root = document.documentElement.style;
    root.setProperty("--stamp", colour);
    root.setProperty("--stamp-glow", `rgba(${r}, ${g}, ${b}, 0.45)`);
    root.setProperty("--stamp-ambient", `rgba(${r}, ${g}, ${b}, 0.12)`);
    // Dark text on light colours, white text on dark ones
    root.setProperty("--stamp-text", (r * 299 + g * 587 + b * 114) / 1000 > 128 ? "#0b0d10" : "#ffffff");
    if (colourCode) colourCode.textContent = colour;
}

// Draws a card from the first 25 phrases (index 12 is the FREE square). Each square counts sightings: a click
// (or Enter) adds one; a right click (or Backspace, or its minus on touch screens) takes one off. A square is
// marked from one up, and onCount(index, count, change) runs after each change.
// notes are descriptions and counts are starting counts, both by the same index
export function drawBoard(phrases, onCount, notes = [], counts = []) {
    bingoCard.replaceChildren();

    for (let i = 0; i < 25; i++) {
        const cell = document.createElement("div");
        cell.classList.add("bingo-cell");

        if (i === 12) {
            // FREE is always marked
            cell.classList.add("center-cell", "crossed");
            cell.innerHTML = '<span class="free-word">FREE</span>';
        } else {
            cell.setAttribute("role", "button");
            cell.tabIndex = 0;
            const minus = Object.assign(document.createElement("button"), { type: "button", className: "cell-minus", textContent: "−" });
            minus.setAttribute("aria-label", "Take one off");
            cell.append(Object.assign(document.createElement("span"), { className: "cell-text", textContent: phrases[i] }), minus);
            if (notes[i]) {
                cell.classList.add("has-note");
                cell.dataset.note = notes[i];
                cell.setAttribute("aria-description", notes[i]);
            }
            const change = by => {
                const count = Math.min(99, Math.max(0, Number(cell.dataset.count) + by));
                if (count === Number(cell.dataset.count)) return;
                setCount(cell, count);
                onCount(i, count, by);
            };
            cell.addEventListener("click", event => change(event.target.closest(".cell-minus") ? -1 : 1));
            // Phones fire contextmenu on a long press too, which opens the details; only a real right click takes one off
            let touched = false;
            cell.addEventListener("pointerdown", event => touched = event.pointerType === "touch");
            cell.addEventListener("contextmenu", event => {
                event.preventDefault();
                if (!touched) change(-1);
            });
            cell.addEventListener("keydown", event => {
                if (event.target !== cell) return; // The minus button's own Enter arrives as a click
                if (event.key === "Enter" || event.key === " ") change(1);
                else if (event.key === "Backspace" || event.key === "Delete" || event.key === "-") change(-1);
                else return;
                event.preventDefault();
            });
            setCount(cell, counts[i] ?? 0);
        }

        bingoCard.appendChild(cell);
    }
}

export function setCount(cell, count) {
    cell.dataset.count = count;
    cell.classList.toggle("crossed", count > 0);
    cell.setAttribute("aria-pressed", count > 0);
}

// Draw the card ourselves. html2canvas drops spaces and doubles letters with this font.
export function captureScreenshot() {
    const cells = [...bingoCard.children];
    const phrases = cells.map((cell, i) => i === 12 ? "FREE" : cell.querySelector(".cell-text").textContent);
    const counts = cells.map(cell => Number(cell.dataset.count) || 0);
    drawCardShot(phrases, counts).toBlob(blob => addWinningCard(blob));
}

function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function wrapText(ctx, text, maxWidth) {
    const lines = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(next).width > maxWidth) {
            lines.push(line);
            line = word;
        } else line = next;
    }
    if (line) lines.push(line);
    return lines;
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
}

function drawCardShot(phrases, counts) {
    const size = 930;
    const titleH = 56;
    const pad = 18;
    const gap = 10;
    const cell = (size - pad * 2 - gap * 4) / 5;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size + titleH;
    const ctx = canvas.getContext("2d");
    const stamp = cssVar("--stamp");
    const stampText = cssVar("--stamp-text");
    const heading = cssVar("--heading");
    const cellBg = cssVar("--cell-bg");
    const cellText = cssVar("--cell-text");
    const border = cssVar("--border");
    const boardBg = cssVar("--board-bg");
    const pageBg = getComputedStyle(document.body).backgroundColor;
    const font = '"Plus Jakarta Sans", system-ui, sans-serif';

    ctx.fillStyle = pageBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    roundRect(ctx, 0, 0, canvas.width, canvas.height, 16);
    ctx.fillStyle = boardBg;
    ctx.fill();

    ctx.fillStyle = heading;
    ctx.font = `800 22px ${font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Dashcam Bingo", size / 2, titleH / 2);

    phrases.forEach((phrase, i) => {
        const col = i % 5;
        const row = Math.floor(i / 5);
        const x = pad + col * (cell + gap);
        const y = titleH + pad + row * (cell + gap);
        const marked = i === 12 || counts[i] > 0;
        roundRect(ctx, x, y, cell, cell, 12);
        ctx.fillStyle = marked ? stamp : cellBg;
        ctx.fill();
        ctx.strokeStyle = marked ? "rgba(255, 255, 255, 0.2)" : border;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = marked ? stampText : cellText;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (i === 12) {
            ctx.font = `800 16px ${font}`;
            ctx.fillText("FREE", x + cell / 2, y + cell / 2);
            return;
        }
        const maxWidth = cell - 16;
        ctx.font = `500 13px ${font}`;
        const lines = wrapText(ctx, phrase, maxWidth);
        const lineH = 17;
        let start = y + cell / 2 - (lines.length - 1) * lineH / 2;
        for (const line of lines) {
            ctx.fillText(line, x + cell / 2, start);
            start += lineH;
        }
        if (counts[i] > 0) {
            const badge = 15;
            const bx = x + cell - 8 - badge / 2;
            const by = y + 8 + badge / 2;
            ctx.beginPath();
            ctx.arc(bx, by, badge / 2, 0, Math.PI * 2);
            ctx.fillStyle = stampText;
            ctx.fill();
            ctx.fillStyle = stamp;
            ctx.font = `800 10px ${font}`;
            ctx.fillText(String(counts[i]), bx, by);
        }
    });
    return canvas;
}

function addWinningCard(blob) {
    winCount++;
    const styles = getComputedStyle(document.documentElement);
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

    const card = document.createElement("div");
    card.className = "win-card";
    card.innerHTML = `
        <div class="win-head">
            <div class="win-num" style="background-color: ${colorPicker.value}; color: ${styles.getPropertyValue("--stamp-text")}">#${winCount}</div>
            <div class="win-info">
                <div class="win-title">Winning card</div>
                <div class="win-time">Achieved at ${time}</div>
            </div>
            <div class="win-tag">✓ BINGO</div>
        </div>`;

    const img = new Image();
    img.src = URL.createObjectURL(blob);
    img.alt = 'Winning Bingo Card Screenshot';
    img.title = 'Click to copy';
    img.onclick = () => copyToClipboard(blob); // Copy to clipboard on click
    card.appendChild(img);

    gallery.prepend(card); // Newest first
    showWinCount();
}

function showWinCount() {
    emptyState.hidden = winCount > 0;
    winCountLabel.textContent = `${winCount} winning card${winCount === 1 ? '' : 's'}`;
}

function copyToClipboard(blob) {
    const item = new ClipboardItem({ 'image/png': blob });
    navigator.clipboard.write([item])
        .then(() => alert("Screenshot copied to clipboard!"))
        .catch(err => alert("Failed to copy: " + err));
}
