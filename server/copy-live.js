// npm run dev:copy-live: copies the live database into data-dev/, which npm run dev uses, so testing there never
// touches real players. Stop the dev server first; it opens the new copy when it starts again
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

if (!existsSync("data/bingo.db")) throw new Error("No live database at data/bingo.db yet. Start the live server once to create it.");
mkdirSync("data-dev", { recursive: true });
for (const end of ["", "-wal", "-shm"]) rmSync(`data-dev/bingo.db${end}`, { force: true }); // VACUUM INTO needs a new file
new DatabaseSync("data/bingo.db").exec("VACUUM INTO 'data-dev/bingo.db'"); // A complete copy, even while the live server writes
console.log("Copied data/bingo.db to data-dev/bingo.db");
