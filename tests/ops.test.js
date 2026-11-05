import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { applyOp, MEMBER_OPS, OP_TYPES, PartyOpError, planLicenseAward } from "../scripts/logic/ops.js";

let counter = 0;
const randomID = () => `id${String(++counter).padStart(14, "0")}`;
const owner = { isOwner: true, randomID, today: "2026-11-05" };
const member = { isOwner: false, randomID };

const base = () => ({
  members: [{ uuid: "Actor.aaaaaaaaaaaaaaaa", role: "" }],
  clocks: [
    { id: "c1", name: "Reactor", segments: 6, value: 2, kind: "threat", hidden: false },
    { id: "c2", name: "Secret", segments: 4, value: 0, kind: "threat", hidden: true }
  ],
  objectives: [{ id: "o1", text: "Hold the line", done: false, hidden: false }],
  reserves: [{ id: "r1", name: "Supply drop", img: "", itemType: "reserve", description: "", quantity: 2, itemData: null }],
  manna: 100,
  log: []
});

const expectCode = (fn, code) => assert.throws(fn, e => e instanceof PartyOpError && e.code === code);

describe("op catalogue", () => {
  test("member ops are a subset of all ops", () => {
    for (const op of MEMBER_OPS) assert.ok(OP_TYPES.has(op), op);
  });
  test("unknown op is invalid", () => expectCode(() => applyOp(base(), { type: "nope" }, owner), "invalid"));
  test("owner-only op refused for members", () => expectCode(() => applyOp(base(), { type: "clock.delete", id: "c1" }, member), "denied"));
});

describe("clocks", () => {
  test("tick clamps to [0, segments] and does not mutate input", () => {
    const src = base();
    const up = applyOp(src, { type: "clock.tick", id: "c1", delta: 10 }, member);
    assert.equal(up.changes["system.clocks"][0].value, 6);
    assert.equal(src.clocks[0].value, 2);
    const down = applyOp(src, { type: "clock.tick", id: "c1", delta: -5 }, member);
    assert.equal(down.changes["system.clocks"][0].value, 0);
  });
  test("hidden clocks are GM-only", () => {
    expectCode(() => applyOp(base(), { type: "clock.tick", id: "c2", delta: 1 }, member), "denied");
    assert.equal(applyOp(base(), { type: "clock.tick", id: "c2", delta: 1 }, owner).result, 1);
  });
  test("add normalises input; players cannot add hidden clocks", () => {
    const { changes, result } = applyOp(base(), { type: "clock.add", name: "  Escape\n", segments: 99, kind: "weird", hidden: true }, member);
    const clock = changes["system.clocks"].at(-1);
    assert.equal(clock.id, result);
    assert.equal(clock.name, "Escape");
    assert.equal(clock.segments, 20);
    assert.equal(clock.kind, "progress");
    assert.equal(clock.hidden, false);
  });
  test("shrinking segments clamps value; members cannot change visibility", () => {
    const src = base();
    src.clocks[0].value = 6;
    const { changes } = applyOp(src, { type: "clock.update", id: "c1", changes: { segments: 4 } }, member);
    assert.equal(changes["system.clocks"][0].value, 4);
    expectCode(() => applyOp(base(), { type: "clock.update", id: "c1", changes: { hidden: true } }, member), "denied");
  });
  test("reset and move", () => {
    const reset = applyOp(base(), { type: "clock.reset" }, owner);
    assert.deepEqual(reset.changes["system.clocks"].map(c => c.value), [0, 0]);
    const moved = applyOp(base(), { type: "clock.move", id: "c1", delta: 1 }, owner);
    assert.deepEqual(moved.changes["system.clocks"].map(c => c.id), ["c2", "c1"]);
  });
  test("missing clock", () => expectCode(() => applyOp(base(), { type: "clock.tick", id: "zz", delta: 1 }, owner), "notFound"));
});

describe("objectives", () => {
  test("add requires text, toggle flips", () => {
    expectCode(() => applyOp(base(), { type: "objective.add", text: "   " }, member), "invalid");
    const t = applyOp(base(), { type: "objective.toggle", id: "o1" }, member);
    assert.equal(t.result, true);
  });
  test("clear only done ones", () => {
    const src = base();
    src.objectives.push({ id: "o2", text: "x", done: true, hidden: false });
    const { changes } = applyOp(src, { type: "objective.clear", onlyDone: true }, owner);
    assert.deepEqual(changes["system.objectives"].map(o => o.id), ["o1"]);
  });
});

describe("reserves and manna", () => {
  test("adjust down to zero removes the entry", () => {
    const one = applyOp(base(), { type: "reserve.adjust", id: "r1", delta: -1 }, member);
    assert.equal(one.changes["system.reserves"][0].quantity, 1);
    const gone = applyOp(base(), { type: "reserve.adjust", id: "r1", delta: -2 }, member);
    assert.equal(gone.changes["system.reserves"].length, 0);
    assert.equal(gone.result.name, "Supply drop");
  });
  test("add keeps a copy of item data", () => {
    const itemData = { name: "Supply drop", type: "reserve", system: { a: 1 } };
    const { changes } = applyOp(base(), { type: "reserve.add", entry: { name: "Supply drop", itemData } }, member);
    const entry = changes["system.reserves"].at(-1);
    itemData.system.a = 2;
    assert.equal(entry.itemData.system.a, 1);
    assert.equal(entry.quantity, 1);
  });
  test("manna never goes negative", () => {
    assert.equal(applyOp(base(), { type: "manna.adjust", delta: -500 }, member).result, 0);
    assert.equal(applyOp(base(), { type: "manna.set", value: "250" }, member).result, 250);
  });
});

describe("member roles", () => {
  test("owner or the member's own player may set a role", () => {
    const uuid = "Actor.aaaaaaaaaaaaaaaa";
    expectCode(() => applyOp(base(), { type: "member.role", uuid, role: "Striker" }, member), "denied");
    const ok = applyOp(base(), { type: "member.role", uuid, role: "Striker" }, { ...member, ownsMember: u => u === uuid });
    assert.equal(ok.changes["system.members"][0].role, "Striker");
  });
});

describe("mission log", () => {
  test("new entries go first and get today's date", () => {
    const { changes } = applyOp(base(), { type: "log.add", entry: { number: 3, name: "Op Iron", outcome: "partial" } }, owner);
    assert.equal(changes["system.log"][0].date, "2026-11-05");
    assert.equal(changes["system.log"][0].outcome, "partial");
  });
  test("members cannot write the log", () => expectCode(() => applyOp(base(), { type: "log.add", entry: {} }, member), "denied"));
});

describe("planLicenseAward", () => {
  test("caps at LL12 and skips unchanged pilots", () => {
    const plan = planLicenseAward([{ uuid: "a", level: 3 }, { uuid: "b", level: 12 }, { uuid: "c", level: 11 }], 2);
    assert.deepEqual(plan, [{ uuid: "a", from: 3, to: 5 }, { uuid: "c", from: 11, to: 12 }]);
  });
});
