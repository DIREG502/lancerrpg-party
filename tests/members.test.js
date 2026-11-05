import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  actorIdFromUuid, collectContainedIds, isWorldActorUuid, normalizeMembers,
  planAddMembers, planRemoveMembers, reorderMember
} from "../scripts/logic/members.js";
import { PARTY_TYPE } from "../scripts/constants.js";

const A = "Actor.aaaaaaaaaaaaaaaa";
const B = "Actor.bbbbbbbbbbbbbbbb";
const C = "Actor.cccccccccccccccc";
const MECH = "Actor.mmmmmmmmmmmmmmmm";

describe("uuid helpers", () => {
  test("accepts only top-level world actors", () => {
    assert.equal(isWorldActorUuid(A), true);
    assert.equal(isWorldActorUuid("Scene.x.Token.y.Actor.aaaaaaaaaaaaaaaa"), false);
    assert.equal(isWorldActorUuid("Compendium.lancer.npcs.Actor.aaaaaaaaaaaaaaaa"), false);
    assert.equal(isWorldActorUuid("Actor.short"), false);
    assert.equal(isWorldActorUuid(null), false);
  });
  test("extracts id", () => {
    assert.equal(actorIdFromUuid(A), "aaaaaaaaaaaaaaaa");
    assert.equal(actorIdFromUuid("Item.aaaaaaaaaaaaaaaa"), null);
  });
});

describe("normalizeMembers", () => {
  test("drops duplicates and malformed rows, keeps roles and order", () => {
    const out = normalizeMembers([{ uuid: B, role: "Support" }, { uuid: A }, { uuid: B, role: "dup" }, { uuid: "bad" }, null]);
    assert.deepEqual(out, [{ uuid: B, role: "Support" }, { uuid: A, role: "" }]);
  });
});

describe("planAddMembers", () => {
  test("adds pilots and NPC allies, refuses deployables and parties", () => {
    const plan = planAddMembers([], [
      { uuid: A, type: "pilot" },
      { uuid: B, type: "npc" },
      { uuid: C, type: "deployable" },
      { uuid: "Actor.pppppppppppppppp", type: PARTY_TYPE }
    ]);
    assert.deepEqual(plan.added, [A, B]);
    assert.deepEqual(plan.skipped.map(s => s.reason), ["type", "type"]);
  });

  test("a piloted mech is redirected to its pilot", () => {
    const plan = planAddMembers([], [{ uuid: MECH, type: "mech", pilotUuid: A }]);
    assert.deepEqual(plan.added, [A]);
    assert.deepEqual(plan.redirected, [{ from: MECH, to: A }]);
    assert.deepEqual(plan.entries, [{ uuid: A, role: "" }]);
  });

  test("an unpiloted mech joins directly", () => {
    const plan = planAddMembers([], [{ uuid: MECH, type: "mech", pilotUuid: null }]);
    assert.deepEqual(plan.added, [MECH]);
  });

  test("mech whose pilot is already a member is a duplicate", () => {
    const plan = planAddMembers([{ uuid: A, role: "Lead" }], [{ uuid: MECH, type: "mech", pilotUuid: A }]);
    assert.deepEqual(plan.added, []);
    assert.equal(plan.skipped[0].reason, "duplicate");
    assert.deepEqual(plan.entries, [{ uuid: A, role: "Lead" }]);
  });

  test("rejects token actors", () => {
    const plan = planAddMembers([], [{ uuid: "Scene.s.Token.t.Actor.aaaaaaaaaaaaaaaa", type: "pilot" }]);
    assert.equal(plan.skipped[0].reason, "invalid");
  });
});

describe("planRemoveMembers / reorderMember", () => {
  test("removes listed uuids", () => {
    const { entries, removed } = planRemoveMembers([{ uuid: A }, { uuid: B }], [B, C]);
    assert.deepEqual(removed, [B]);
    assert.deepEqual(entries, [{ uuid: A, role: "" }]);
  });
  test("reorders and clamps index", () => {
    const list = [{ uuid: A }, { uuid: B }, { uuid: C }];
    assert.deepEqual(reorderMember(list, C, 0).map(e => e.uuid), [C, A, B]);
    assert.deepEqual(reorderMember(list, A, 99).map(e => e.uuid), [B, C, A]);
    assert.deepEqual(reorderMember(list, "Actor.zzzzzzzzzzzzzzzz", 0).map(e => e.uuid), [A, B, C]);
  });
});

describe("collectContainedIds", () => {
  test("members and optionally mechs", () => {
    const parties = [{ memberIds: ["a", "b"], mechIds: ["m"] }, { memberIds: ["b", "c"], mechIds: [] }];
    assert.deepEqual([...collectContainedIds(parties)].sort(), ["a", "b", "c", "m"]);
    assert.deepEqual([...collectContainedIds(parties, { includeMechs: false })].sort(), ["a", "b", "c"]);
  });
});
