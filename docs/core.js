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

themeButton.addEventListener("click", () => {
    theme = themes[(themes.indexOf(theme) + 1) % themes.length];
    save("theme", theme);
    showTheme();
});

// Colour menu: preset colours, the last 5 picked on this device, and a custom picker
const presetColours = {
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

colourButton.addEventListener("click", () => setColourMenuOpen(colourPopover.hidden));

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
    colourPopover.hidden = !open;
    colourButton.setAttribute("aria-expanded", open);
}

function pickColour(colour) {
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
function load(key) {
    try { return localStorage.getItem("dashcamBingo." + key); } catch (e) { return null; }
}

function save(key, value) {
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
    colourCode.textContent = colour;
}

// Draws a card from the first 25 phrases (index 12 is the FREE square); onMark runs after each tap
export function drawBoard(phrases, onMark) {
    bingoCard.replaceChildren();

    for (let i = 0; i < 25; i++) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.classList.add("bingo-cell");

        if (i === 12) {
            // FREE is always marked
            cell.classList.add("center-cell", "crossed");
            cell.innerHTML = '<span class="free-word">FREE</span>';
            cell.disabled = true;
        } else {
            cell.textContent = phrases[i];
            cell.setAttribute("aria-pressed", "false");
            cell.addEventListener("click", () => {
                setCrossed(cell, !cell.classList.contains("crossed"));
                onMark(i, cell.classList.contains("crossed"));
            });
        }

        bingoCard.appendChild(cell);
    }
}

export function setCrossed(cell, crossed) {
    cell.classList.toggle("crossed", crossed);
    cell.setAttribute("aria-pressed", crossed);
}

export function captureScreenshot() {
    const container = document.getElementById("bingoCardContainer");
    container.classList.add("capturing"); // Show the title in the screenshot

    html2canvas(container, { backgroundColor: getComputedStyle(document.body).backgroundColor }).then(canvas => {
        container.classList.remove("capturing");
        canvas.toBlob(blob => addWinningCard(blob));
    });
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
