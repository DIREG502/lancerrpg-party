import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  activeMechOf, bar, deployableActorFor, isMutualLink, memberSnapshot, memberSubtitle, pilotOf,
  pips, summarizeParty, tokenSize
} from "../scripts/logic/lancer.js";

/** Build Lancer-shaped fake actors (prepared data as Lancer 3.x exposes it). */
function makePair({ linked = true } = {}) {
  const pilot = {
    id: "p", uuid: "Actor.pppppppppppppppp", name: "Ada", img: "p.svg", type: "pilot",
    statuses: new Set(["prone"]),
    system: {
      callsign: "WRAITH", player_name: "Kim", level: 4, grit: 2, mounted: true,
      hp: { value: 4, max: 8 }, hull: 1, agi: 2, sys: 0, eng: 1
    }
  };
  const mech = {
    id: "m", uuid: "Actor.mmmmmmmmmmmmmmmm", name: "Nightjar", img: "m.svg", type: "mech",
    statuses: new Set(),
    system: {
      hp: { value: 7, max: 10 }, heat: { value: 3, max: 6 }, overshield: { value: 2 }, burn: 1,
      structure: { value: 3, max: 4 }, stress: { value: 4, max: 4 }, repairs: { value: 2, max: 5 },
      core_energy: 1, core_active: false, overcharge: 1,
      evasion: 10, edef: 8, armor: 1, speed: 5, sensor_range: 10, save: 11, tech_attack: 0, size: 1,
      hull: 1, agi: 2, sys: 0, eng: 1,
      loadout: { frame: { status: "resolved", value: { name: "Lancaster" } } },
      pilot: { id: linked ? pilot.uuid : "Actor.zzzzzzzzzzzzzzzz", status: "resolved", value: linked ? pilot : null }
    }
  };
  pilot.system.active_mech = { id: mech.uuid, status: "resolved", value: mech };
  return { pilot, mech };
}

const statusInfo = id => ({ prone: { img: "prone.svg", name: "Prone" } })[id];
const format = (key, data) => `${key}${data ? JSON.stringify(data) : ""}`;

describe("pilot ↔ mech links", () => {
  test("resolves both directions", () => {
    const { pilot, mech } = makePair();
    assert.equal(activeMechOf(pilot), mech);
    assert.equal(pilotOf(mech), pilot);
    assert.equal(isMutualLink(pilot, mech), true);
  });
  test("one-sided link is reported as not mutual", () => {
    const { pilot, mech } = makePair({ linked: false });
    assert.equal(activeMechOf(pilot), mech);
    assert.equal(isMutualLink(pilot, mech), false);
  });
  test("missing references resolve to null", () => {
    const pilot = { type: "pilot", system: { active_mech: { id: "x", status: "missing", value: null } } };
    assert.equal(activeMechOf(pilot), null);
    assert.equal(activeMechOf({ type: "npc", system: {} }), null);
    assert.equal(pilotOf({ type: "mech", system: {} }), null);
  });
});

describe("snapshots", () => {
  test("pilot snapshot includes mech combat data", () => {
    const { pilot } = makePair();
    const snap = memberSnapshot(pilot, { statusInfo });
    assert.equal(snap.callsign, "WRAITH");
    assert.equal(snap.level, 4);
    assert.deepEqual(snap.statuses, [{ id: "prone", img: "prone.svg", label: "Prone" }]);
    assert.equal(snap.mech.frame, "Lancaster");
    assert.deepEqual(snap.mech.hp, { value: 7, max: 10, pct: 70 });
    assert.equal(snap.mech.structurePips.filter(p => p.filled).length, 3);
    assert.equal(snap.mech.stats.sensors, 10);
    assert.equal(snap.mechLinked, true);
    assert.equal(memberSubtitle(snap, format), 'WRAITH · LANCERPARTY.Member.LL{"level":4} · Nightjar (Lancaster)');
  });

  test("tolerates half-prepared actors", () => {
    const snap = memberSnapshot({ id: "x", uuid: "Actor.xxxxxxxxxxxxxxxx", name: "?", type: "mech", system: {} });
    assert.equal(snap.mech.hp, null);
    assert.equal(snap.mech.frame, null);
    assert.equal(snap.mech.structurePips, null);
  });

  test("bars and pips", () => {
    assert.deepEqual(bar({ value: 5, max: 0 }), { value: 5, max: 0, pct: 0 });
    assert.equal(bar({ value: "x", max: 3 }), null);
    assert.equal(pips(1, 40), null);
    assert.equal(pips(2, 3).length, 3);
  });

  test("party summary", () => {
    const { pilot } = makePair();
    const other = { ...memberSnapshot(pilot), level: 6, mech: null };
    const summary = summarizeParty([memberSnapshot(pilot), other]);
    assert.equal(summary.averageLL, 5);
    assert.equal(summary.minLL, 4);
    assert.equal(summary.maxLL, 6);
    assert.equal(summary.mechs, 1);
    assert.equal(summary.damaged, 1);
    assert.equal(summary.structure, 3);
  });
});

describe("deployment helpers", () => {
  test("auto deploys the mech when there is one", () => {
    const { pilot, mech } = makePair();
    assert.equal(deployableActorFor(pilot, "auto"), mech);
    assert.equal(deployableActorFor(pilot, "pilot"), pilot);
    assert.equal(deployableActorFor({ type: "pilot", system: {} }, "mech"), null);
    assert.equal(deployableActorFor({ type: "pilot", system: {} }, "auto").type, "pilot");
  });
  test("token size: Lancer size ½ takes one cell", () => {
    assert.equal(tokenSize({ system: { size: 0.5 } }), 1);
    assert.equal(tokenSize({ system: { size: 3 } }), 3);
    assert.equal(tokenSize({ system: {}, prototypeToken: { width: 2 } }), 2);
  });
});
