import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { cellKey, occupy, planFormation, ringOffsets } from "../scripts/logic/formation.js";
import { clockSegments } from "../scripts/logic/clock.js";
import {
  collectSkillOptions, evaluateGroupCheck, normalizeCheck, parseCheckValue, recordResult, skillKey
} from "../scripts/logic/group-check.js";

describe("formation", () => {
  test("ring 1 has 8 cells, nearest (orthogonal) first", () => {
    const ring = ringOffsets({ i: 5, j: 5 }, 1);
    assert.equal(ring.length, 8);
    const first4 = ring.slice(0, 4).map(c => Math.abs(c.i - 5) + Math.abs(c.j - 5));
    assert.deepEqual(first4, [1, 1, 1, 1]);
  });

  test("tokens never overlap each other or occupied cells", () => {
    const occupied = new Set();
    occupy(occupied, { i: 10, j: 10 }, 1);
    const sizes = [2, 1, 1, 3, 1];
    const plan = planFormation({ anchor: { i: 10, j: 10 }, sizes, occupied });
    const taken = new Set(occupied);
    plan.forEach((cell, k) => {
      assert.ok(cell, `token ${k} placed`);
      const n = sizes[k];
      for (let di = 0; di < n; di++) for (let dj = 0; dj < n; dj++) {
        const key = cellKey(cell.i + di, cell.j + dj);
        assert.ok(!taken.has(key), `overlap at ${key}`);
        taken.add(key);
      }
    });
  });

  test("respects scene bounds and reports no room", () => {
    const plan = planFormation({ anchor: { i: 0, j: 0 }, sizes: [1, 1, 1, 1, 1], bounds: { rows: 2, cols: 2 } });
    assert.equal(plan.filter(Boolean).length, 4);
    assert.equal(plan[4], null);
    for (const c of plan.filter(Boolean)) assert.ok(c.i >= 0 && c.j >= 0 && c.i < 2 && c.j < 2);
  });
});

describe("clock geometry", () => {
  test("segment count and fill", () => {
    const segs = clockSegments(6, 2);
    assert.equal(segs.length, 6);
    assert.deepEqual(segs.map(s => s.filled), [true, true, false, false, false, false]);
    assert.ok(segs[0].d.startsWith("M 0 0 L 0 -46"));
  });
  test("clamps value", () => {
    assert.equal(clockSegments(4, 99).filter(s => s.filled).length, 4);
    assert.equal(clockSegments(4, -3).filter(s => s.filled).length, 0);
  });
});

describe("group check", () => {
  test("skillKey prefers lid", () => {
    assert.equal(skillKey({ name: "Act Unseen or Unheard", system: { lid: "sk_act_unseen_or_unheard" } }), "sk_act_unseen_or_unheard");
    assert.equal(skillKey({ name: "Spin a Yarn" }), "name:spin-a-yarn");
    assert.equal(skillKey({ name: "Взломать систему" }), "name:взломать-систему");
  });

  test("collectSkillOptions merges by key and counts pilots", () => {
    const opts = collectSkillOptions([
      [{ name: "Hack or Fix", system: { lid: "sk_hack" } }, { name: "Hack or Fix", system: { lid: "sk_hack" } }],
      [{ name: "Hack/Fix (renamed)", system: { lid: "sk_hack" } }, { name: "Apply Fists to Faces", system: { lid: "sk_fists" } }]
    ]);
    assert.deepEqual(opts.map(o => [o.key, o.count]), [["sk_fists", 1], ["sk_hack", 2]]);
  });

  test("parse and normalise check values", () => {
    assert.deepEqual(parseCheckValue("hase:agi"), { kind: "hase", key: "agi" });
    assert.deepEqual(parseCheckValue("skill:sk_hack"), { kind: "skill", key: "sk_hack" });
    assert.deepEqual(parseCheckValue("grit"), { kind: "grit", key: "" });
    assert.equal(parseCheckValue("hase:luck"), null);
    assert.equal(normalizeCheck({ kind: "skill", key: "" }), null);
  });

  const rows = totals => totals.map((total, k) => ({ uuid: `u${k}`, name: "", img: "", total, rollerUuid: null }));

  test("all: early failure, success when complete", () => {
    assert.equal(evaluateGroupCheck(rows([12, null]), "all").outcome, null);
    assert.equal(evaluateGroupCheck(rows([9, null]), "all").outcome, "failure");
    assert.equal(evaluateGroupCheck(rows([10, 15]), "all").outcome, "success");
  });
  test("any: early success", () => {
    assert.equal(evaluateGroupCheck(rows([14, null, null]), "any").outcome, "success");
    assert.equal(evaluateGroupCheck(rows([3, 4]), "any").outcome, "failure");
  });
  test("majority: decided as soon as it can't change", () => {
    assert.equal(evaluateGroupCheck(rows([12, 12, null, null]), "majority").outcome, null);
    assert.equal(evaluateGroupCheck(rows([12, 12, 12, null]), "majority").outcome, "success");
    assert.equal(evaluateGroupCheck(rows([1, 2, 3, null]), "majority").outcome, "failure");
  });
  test("each never aggregates", () => {
    const r = evaluateGroupCheck(rows([20, 1]), "each");
    assert.equal(r.outcome, null);
    assert.equal(r.successes, 1);
    assert.equal(r.complete, true);
  });

  test("recordResult refuses double rolls unless allowed", () => {
    const start = rows([null, null]);
    const once = recordResult(start, "u0", 13, { rollerUuid: "Actor.m" });
    assert.equal(once[0].total, 13);
    assert.equal(start[0].total, null);
    assert.equal(recordResult(once, "u0", 2), null);
    assert.equal(recordResult(once, "u0", 2, { allowReroll: true })[0].total, 2);
    assert.equal(recordResult(once, "nobody", 2), null);
    assert.equal(recordResult(once, "u1", Number.NaN), null);
  });
});
