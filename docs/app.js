// Solo game: deals cards in the browser and checks for wins locally
import { drawBoard, setCount, captureScreenshot } from "./core.js";
import { countLines } from "./shared/lines.js";

const bingoCard = document.getElementById("bingoCard");
const bingoAlert = document.getElementById("bingoAlert");
let bestLines = 0; // Most lines completed on this card so far

loadBingoCard();

document.getElementById("refreshButton").addEventListener("click", () => {
    bestLines = 0;
    loadBingoCard();
});

// Unmark everything except FREE, keeping the same card
document.getElementById("clearButton").addEventListener("click", () => {
    bingoCard.querySelectorAll(".bingo-cell.crossed:not(.center-cell)").forEach(cell => setCount(cell, 0));
    bestLines = 0;
    checkBingo();
});

function loadBingoCard() {
    fetch('phrases.txt')
        .then(response => response.text())
        .then(text => {
            const phrases = text.split('\n').map(line => line.trim()).filter(line => line !== "");
            phrases.sort(() => Math.random() - 0.5);
            drawBoard(phrases, checkBingo);
            checkBingo();
        })
        .catch(error => console.error('Error loading phrases:', error));
}

function checkBingo() {
    const marked = new Set();
    Array.from(bingoCard.children).forEach((cell, i) => {
        if (cell.classList.contains("crossed")) marked.add(i);
    });
    const lines = countLines(marked);

    bingoAlert.hidden = lines === 0;

    // Only screenshot when a new line is completed, not on every click after a bingo
    if (lines > bestLines) {
        bestLines = lines;
        captureScreenshot();
    }
}
