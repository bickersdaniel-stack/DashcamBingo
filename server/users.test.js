import assert from "node:assert/strict";
import test from "node:test";

process.env.ADMIN_IDS = "owner"; // Read when auth.js loads, so set before importing
const { userChangeProblem } = await import("./users.js");

test("userChangeProblem keeps owners as admins and stops people locking themselves out", () => {
    const player = { wins: 3 };
    assert.equal(userChangeProblem("p1", player, { wins: 0 }, "me"), null);
    assert.equal(userChangeProblem("p1", player, { admin: true }, "me"), null);
    assert.equal(userChangeProblem("p1", player, { blocked: true }, "me"), null);
    assert.match(userChangeProblem("p1", player, { wins: -1 }, "me"), /whole number/);
    assert.match(userChangeProblem("p1", player, { wins: 1.5 }, "me"), /whole number/);
    assert.match(userChangeProblem("p1", player, { admin: "yes" }, "me"), /yes or no/);
    assert.match(userChangeProblem("owner", {}, { admin: false }, "me"), /Owners/);
    assert.match(userChangeProblem("owner", {}, { blocked: true }, "me"), /Owners/);
    assert.match(userChangeProblem("me", { admin: true }, { admin: false }, "me"), /your own/);
    assert.match(userChangeProblem("p1", { admin: true }, { blocked: true }, "me"), /Remove their admin first/);
    assert.match(userChangeProblem("p1", { blocked: true }, { admin: true }, "me"), /Unblock them first/);
});
