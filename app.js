document.addEventListener("DOMContentLoaded", () => {
    const bingoCard = document.getElementById("bingoCard");
    const bingoTitle = document.getElementById("bingoTitle");
    const gallery = document.getElementById("gallery");
    const colorPicker = document.getElementById("colorPicker");
    const themeButton = document.getElementById("themeButton");
    let bestLines = 0; // Most lines completed on this card so far

    // Theme button cycles System -> Light -> Dark, remembered on this device
    const themes = ["system", "light", "dark"];
    const themeLabels = { system: ["🖥️", "System"], light: ["☀️", "Light"], dark: ["🌙", "Dark"] };
    let theme = themes.includes(load("theme")) ? load("theme") : "system";
    showTheme();

    themeButton.addEventListener("click", () => {
        theme = themes[(themes.indexOf(theme) + 1) % themes.length];
        save("theme", theme);
        showTheme();
    });

    // Use the colour picked last time on this device
    const savedColour = load("colour");
    if (savedColour) colorPicker.value = savedColour;

    // Load the initial bingo card with default colors
    loadBingoCard();

    // Event listener for color picker to change color of all crossed cells
    colorPicker.addEventListener("input", (event) => {
        setSelectedCellColor(event.target.value);
        save("colour", event.target.value);
    });

    function showTheme() {
        if (theme === "system") {
            delete document.documentElement.dataset.theme;
        } else {
            document.documentElement.dataset.theme = theme;
        }
        const [icon, name] = themeLabels[theme];
        themeButton.innerHTML = `${icon}<span class="theme-label"> ${name}</span>`;
    }

    // Saved settings live in this browser only; ignore errors if storage is blocked
    function load(key) {
        try { return localStorage.getItem("dashcamBingo." + key); } catch (e) { return null; }
    }

    function save(key, value) {
        try { localStorage.setItem("dashcamBingo." + key, value); } catch (e) {}
    }

    function loadBingoCard() {
        bingoCard.innerHTML = ''; // Clear any existing cells

        fetch('phrases.txt')
            .then(response => response.text())
            .then(text => {
                const phrases = text.split('\n').map(line => line.trim()).filter(line => line !== "");
                phrases.sort(() => Math.random() - 0.5);

                for (let i = 0; i < 25; i++) {
                    const cell = document.createElement("div");
                    cell.classList.add("bingo-cell");

                    if (i === 12) {
                        cell.textContent = "FREE";
                        cell.classList.add("center-cell", "crossed");
                        cell.style.backgroundColor = colorPicker.value; // FREE starts crossed in the picked colour
                    } else {
                        cell.textContent = phrases[i];
                    }

                    cell.addEventListener("click", () => {
                        // Toggle crossed class for all cells, including FREE cell
                        cell.classList.toggle("crossed");

                        // Change color if the cell is selected (crossed)
                        if (cell.classList.contains("crossed")) {
                            cell.style.backgroundColor = colorPicker.value;
                        } else {
                            cell.style.backgroundColor = ""; // Back to the normal colour (yellow for FREE)
                        }

                        checkBingo();
                    });

                    bingoCard.appendChild(cell);
                }
            })
            .catch(error => console.error('Error loading phrases:', error));
    }

    function setSelectedCellColor(color) {
        // Update color of all cells that are crossed, including the FREE cell
        const crossedCells = document.querySelectorAll(".bingo-cell.crossed");
        crossedCells.forEach(cell => {
            cell.style.backgroundColor = color;
        });
    }

    function checkBingo() {
        const cells = Array.from(bingoCard.children);
        const lines = checkRows(cells) + checkColumns(cells) + checkDiagonals(cells);

        bingoTitle.style.display = lines > 0 ? 'block' : 'none';

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
        const titleOverlay = document.getElementById("titleOverlay");
        titleOverlay.style.display = "block"; // Show title overlay
    
        html2canvas(document.getElementById('bingoCardContainer')).then(canvas => {
            canvas.toBlob(blob => {
                const img = new Image();
                img.src = URL.createObjectURL(blob);
                img.alt = 'Winning Bingo Card Screenshot';
                img.onclick = () => copyToClipboard(blob); // Copy to clipboard on click
    
                gallery.appendChild(img);
    
                titleOverlay.style.display = "none"; // Hide title overlay after screenshot
            });
        });
    }
    

    function copyToClipboard(blob) {
        const item = new ClipboardItem({ 'image/png': blob });
        navigator.clipboard.write([item])
            .then(() => alert("Screenshot copied to clipboard!"))
            .catch(err => alert("Failed to copy: " + err));
    }

    window.refreshCard = () => {
        bingoTitle.style.display = 'none';
        bestLines = 0;
        loadBingoCard(); // Reload the bingo card only
    };
});
