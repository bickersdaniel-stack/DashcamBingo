document.addEventListener("DOMContentLoaded", () => {
    const bingoCard = document.getElementById("bingoCard");
    const bingoAlert = document.getElementById("bingoAlert");
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
    let bestLines = 0; // Most lines completed on this card so far
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

    loadBingoCard();

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

    document.getElementById("refreshButton").addEventListener("click", () => {
        bestLines = 0;
        loadBingoCard();
    });

    // Unmark everything except FREE, keeping the same card
    document.getElementById("clearButton").addEventListener("click", () => {
        bingoCard.querySelectorAll(".bingo-cell.crossed:not(.center-cell)").forEach(cell => setCrossed(cell, false));
        bestLines = 0;
        checkBingo();
    });

    document.getElementById("clearHistoryButton").addEventListener("click", () => {
        gallery.querySelectorAll(".win-card").forEach(card => {
            URL.revokeObjectURL(card.querySelector("img").src);
            card.remove();
        });
        winCount = 0;
        showWinCount();
    });

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

    function loadBingoCard() {
        bingoCard.innerHTML = ''; // Clear any existing cells

        fetch('phrases.txt')
            .then(response => response.text())
            .then(text => {
                const phrases = text.split('\n').map(line => line.trim()).filter(line => line !== "");
                phrases.sort(() => Math.random() - 0.5);

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
                            checkBingo();
                        });
                    }

                    bingoCard.appendChild(cell);
                }
                checkBingo();
            })
            .catch(error => console.error('Error loading phrases:', error));
    }

    function setCrossed(cell, crossed) {
        cell.classList.toggle("crossed", crossed);
        cell.setAttribute("aria-pressed", crossed);
    }

    function checkBingo() {
        const cells = Array.from(bingoCard.children);
        const lines = checkRows(cells) + checkColumns(cells) + checkDiagonals(cells);

        bingoAlert.hidden = lines === 0;

        // Only screenshot when a new line is completed, not on every click after a bingo
        if (lines > bestLines) {
            bestLines = lines;
            captureScreenshot();
        }
    }

    function checkRows(cells) {
        let lines = 0;
        for (let i = 0; i < 5; i++) {
            if (cells.slice(i * 5, i * 5 + 5).every(cell => cell.classList.contains('crossed'))) {
                lines++;
            }
        }
        return lines;
    }

    function checkColumns(cells) {
        let lines = 0;
        for (let i = 0; i < 5; i++) {
            if ([0, 5, 10, 15, 20].map(j => cells[i + j]).every(cell => cell.classList.contains('crossed'))) {
                lines++;
            }
        }
        return lines;
    }

    function checkDiagonals(cells) {
        const diagonal1 = [0, 6, 12, 18, 24].every(i => cells[i].classList.contains('crossed'));
        const diagonal2 = [4, 8, 12, 16, 20].every(i => cells[i].classList.contains('crossed'));
        return diagonal1 + diagonal2;
    }

    function captureScreenshot() {
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
});
