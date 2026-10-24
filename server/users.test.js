import assert from "node:assert/strict";
import test from "node:test";

process.env.ADMIN_IDS = "owner"; // Read when auth.js loads, so set before importing
const { cardTable, suggestionTable } = await import("./store.js");
const { userChangeProblem, listAdminUsers } = await import("./users.js");

test("userChangeProblem keeps owners as admins and stops people locking themselves out", () => {
    const player = { wins: 3 };
    assert.equal(userChangeProblem("p1", player, { wins: 0 }, "me"), null);
    assert.equal(userChangeProblem("p1", player, { admin: true }, "me"), null);
    assert.equal(userChangeProblem("p1", player, { blocked: true }, "me"), null);
    assert.match(userChangeProblem("p1", player, { wins: -1 }, "me"), /whole number/);
    assert.match(userChangeProblem("p1", player, { wins: 1.5 }, "me"), /whole number/);
    assert.equal(userChangeProblem("p1", player, { coins: 0 }, "me"), null);
    assert.equal(userChangeProblem("p1", player, { coins: 2500 }, "me"), null);
    assert.match(userChangeProblem("p1", player, { coins: -5 }, "me"), /Coins must be/);
    assert.match(userChangeProblem("p1", player, { coins: 10.5 }, "me"), /Coins must be/);
    assert.match(userChangeProblem("p1", player, { coins: "100" }, "me"), /Coins must be/);
    assert.match(userChangeProblem("p1", player, { coins: 1_000_001 }, "me"), /Coins must be/);
    assert.match(userChangeProblem("p1", player, { admin: "yes" }, "me"), /yes or no/);
    assert.match(userChangeProblem("owner", {}, { admin: false }, "me"), /Owners/);
    assert.match(userChangeProblem("owner", {}, { blocked: true }, "me"), /Owners/);
    assert.match(userChangeProblem("me", { admin: true }, { admin: false }, "me"), /your own/);
    assert.match(userChangeProblem("p1", { admin: true }, { blocked: true }, "me"), /Remove their admin first/);
    assert.match(userChangeProblem("p1", { blocked: true }, { admin: true }, "me"), /Unblock them first/);
});

test("listAdminUsers includes people who only left a name on a suggestion or card", () => {
    suggestionTable.put("s-test", { id: "s-test", by: { id: "only-suggested", name: "Pat" }, status: "pending" });
    cardTable.put("c-test", { id: "c-test", by: { id: "only-card", name: "Kim" } });
    try {
        const ids = listAdminUsers().map(user => user.id);
        assert.ok(ids.includes("only-suggested"));
        assert.ok(ids.includes("only-card"));
        assert.equal(listAdminUsers().find(user => user.id === "only-suggested").suggested, 1);
    } finally {
        suggestionTable.remove("s-test");
        cardTable.remove("c-test");
    }
});
