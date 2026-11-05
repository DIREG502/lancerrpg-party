/**
 * Tests for the Foundry-facing modules against a minimal mock of Foundry globals
 * (see tests/helpers/foundry-mock.js). These verify our own permission, relay, data-model and
 * directory logic; they don't prove behaviour inside a real Foundry client.
 */
import { before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { MockActor, MockUser, addActor, installFoundryMock, makePilotWithMech } from "./helpers/foundry-mock.js";

const env = installFoundryMock();
const { PARTY_TYPE, QUERY_NAME } = await import("../scripts/constants.js");
const { PartyModel } = await import("../scripts/data/party-model.js");
const relay = await import("../scripts/relay.js");
const { extendActorsCollection } = await import("../scripts/apps/directory.js");
const { rollPlanFor } = await import("../scripts/apps/group-check.js");

const SCHEMA_KEYS = ["members", "description", "mission", "objectives", "clocks", "reserves", "manna", "log"];

function makeParty(id, data = {}, ownership = {}) {
  const source = {
    members: [], description: "", mission: { number: 1, name: "", sitrep: "", status: "planning", briefing: "" },
    objectives: [], clocks: [], reserves: [], manna: 0, log: [], ...data
  };
  const model = Object.create(PartyModel.prototype);
  model._source = source;
  model._sourceRef = source;
  for (const key of SCHEMA_KEYS) Object.defineProperty(model, key, { get: () => source[key], enumerable: true });
  const party = new MockActor({ id, type: PARTY_TYPE, ownership, system: model });
  model.parent = party;
  return addActor(party);
}

let gm, player, other;
let pilot, mech, npc, party;

beforeEach(() => {
  game.actors.clear();
  env.users.clear();
  gm = new MockUser({ id: "gm", isGM: true });
  player = new MockUser({ id: "p1" });
  other = new MockUser({ id: "p2" });
  for (const u of [gm, player, other]) env.users.set(u.id, u);
  game.user = gm;
  ({ pilot, mech } = makePilotWithMech("pilotAAAAAAAAAAA", "mechAAAAAAAAAAAA", { p1: 3 }));
  addActor(pilot);
  addActor(mech);
  npc = addActor(new MockActor({ id: "npcAAAAAAAAAAAAA", type: "npc", system: { hull: 1 } }));
  party = makeParty("partyAAAAAAAAAAA", { clocks: [{ id: "c1", name: "Reactor", segments: 4, value: 0, kind: "threat", hidden: false }] });
  CONFIG.queries[QUERY_NAME] = relay.handleQuery;
  env.store["lancer-party.memberEditing"] = true;
});

describe("PartyModel", () => {
  test("schema defines every field the sheet uses", () => {
    const schema = PartyModel.defineSchema();
    assert.deepEqual(Object.keys(schema).sort(), [...SCHEMA_KEYS].sort());
  });

  test("supplies the properties LancerActor/LancerTokenDocument read", () => {
    party.system.prepareBaseData();
    assert.deepEqual(party.system.statuses, {});
    assert.deepEqual(party.system.resistances, {});
    assert.equal(party.system.size, 1);
    const data = { system: { manna: 5 } };
    assert.equal(party.system.full_update_data(data), data);
  });

  test("adding a piloted mech adds its pilot; involves() covers the mech", async () => {
    const plan = await party.system.addMembers(mech, npc);
    assert.deepEqual(plan.added, [pilot.uuid, npc.uuid]);
    assert.deepEqual(party.updates.at(-1).changes, { "system.members": [{ uuid: pilot.uuid, role: "" }, { uuid: npc.uuid, role: "" }] });
    assert.equal(party.system.involves(pilot), true);
    assert.equal(party.system.involves(mech), true);
    assert.deepEqual(party.system.mechActors, [mech]);
    await party.system.removeMembers(npc);
    assert.deepEqual(party.system.members.map(m => m.uuid), [pilot.uuid]);
  });

  test("missing members are detected and pruned", async () => {
    party.system._source.members = [{ uuid: pilot.uuid, role: "" }, { uuid: "Actor.goneAAAAAAAAAAAA", role: "" }];
    assert.deepEqual(party.system.missingMembers, ["Actor.goneAAAAAAAAAAAA"]);
    await party.system.pruneMissing();
    assert.deepEqual(party.system.members.map(m => m.uuid), [pilot.uuid]);
  });
});

describe("permissions and relay", () => {
  test("a player who owns a member may contribute but not manage", async () => {
    await party.system.addMembers(pilot);
    assert.equal(relay.canManage(party, player), false);
    assert.equal(relay.canContribute(party, player), true);
    assert.equal(relay.canContribute(party, other), false);
    env.store["lancer-party.memberEditing"] = false;
    assert.equal(relay.canContribute(party, player), false);
  });

  test("player op goes to the GM via query and is applied there", async () => {
    await party.system.addMembers(pilot);
    game.user = player;
    // In this mock the "GM client" is the same process: the handler checks game.user.isGM.
    const query = gm.query.bind(gm);
    gm.query = async (name, data) => {
      game.user = gm;
      try { return await query(name, data); } finally { game.user = player; }
    };
    const result = await relay.requestPartyOp(party, { type: "clock.tick", id: "c1", delta: 1 });
    assert.equal(result, 1);
    assert.equal(gm.queries.at(-1).data.userId, "p1");
    assert.equal(party.system.clocks[0].value, 1);
    assert.equal(party.updates.at(-1).options.lancerParty.userId, "p1");
  });

  test("GM refuses owner-only ops from players and requests from non-members", async () => {
    await party.system.addMembers(pilot);
    const denied = await relay.handleQuery({ action: "partyOp", partyUuid: party.uuid, userId: "p1", op: { type: "clock.delete", id: "c1" } });
    assert.deepEqual(denied, { ok: false, code: "denied" });
    const stranger = await relay.handleQuery({ action: "partyOp", partyUuid: party.uuid, userId: "p2", op: { type: "clock.tick", id: "c1", delta: 1 } });
    assert.deepEqual(stranger, { ok: false, code: "denied" });
    const unknownUser = await relay.handleQuery({ action: "partyOp", partyUuid: party.uuid, userId: "nobody", op: { type: "clock.tick", id: "c1", delta: 1 } });
    assert.equal(unknownUser.ok, false);
  });

  test("non-GM clients never execute relayed requests", async () => {
    game.user = player;
    const res = await relay.handleQuery({ action: "partyOp", partyUuid: party.uuid, userId: "p1", op: { type: "clock.tick", id: "c1", delta: 1 } });
    assert.deepEqual(res, { ok: false, code: "denied" });
  });

  test("concurrent ops on one party are serialised (no lost update)", async () => {
    await Promise.all([
      relay.executePartyOp(party, { type: "clock.tick", id: "c1", delta: 1 }, gm),
      relay.executePartyOp(party, { type: "clock.tick", id: "c1", delta: 1 }, gm),
      relay.executePartyOp(party, { type: "clock.add", name: "Escape", segments: 6 }, gm)
    ]);
    assert.equal(party.system.clocks[0].value, 2);
    assert.equal(party.system.clocks.length, 2);
  });

  test("requestPartyOp warns instead of throwing when no GM is online", async () => {
    await party.system.addMembers(pilot);
    env.users.delete("gm");
    game.user = player;
    let warned = false;
    ui.notifications.warn = () => { warned = true; };
    const res = await relay.requestPartyOp(party, { type: "clock.tick", id: "c1", delta: 1 });
    assert.equal(res, undefined);
    assert.equal(warned, true);
  });
});

describe("directory tree filtering", () => {
  class BaseCollection {
    constructor(list) { this.list = list; }
    _getVisibleTreeContents() { return this.list; }
  }
  const Filtered = extendActorsCollection(BaseCollection);

  test("parties and their members (and mechs) leave the main tree", async () => {
    await party.system.addMembers(pilot);
    const extra = addActor(new MockActor({ id: "loneAAAAAAAAAAAA", type: "pilot" }));
    const tree = new Filtered([party, pilot, mech, npc, extra])._getVisibleTreeContents();
    assert.deepEqual(tree.map(a => a.id), [npc.id, extra.id]);
  });

  test("settings control hiding", async () => {
    await party.system.addMembers(pilot);
    env.store["lancer-party.showMechsInSidebar"] = false;
    assert.deepEqual(new Filtered([party, pilot, mech])._getVisibleTreeContents().map(a => a.id), [mech.id]);
    env.store["lancer-party.hideMembers"] = false;
    assert.deepEqual(new Filtered([party, pilot, mech])._getVisibleTreeContents().map(a => a.id), [pilot.id, mech.id]);
    env.store["lancer-party.showMechsInSidebar"] = true;
  });

  test("without parties the tree is untouched", () => {
    const list = [pilot, mech];
    assert.equal(new Filtered(list)._getVisibleTreeContents(), list);
  });
});

describe("group check roll plans", () => {
  test("HASE rolls with the active mech, grit with the pilot", () => {
    const hase = rollPlanFor(pilot, { kind: "hase", key: "hull", label: "Hull" });
    assert.equal(hase.actor, mech);
    assert.equal(hase.path, "system.hull");
    assert.equal(hase.bonus, 2);
    const grit = rollPlanFor(pilot, { kind: "grit", key: "", label: "Grit" });
    assert.equal(grit.actor, pilot);
    assert.equal(grit.bonus, 1);
  });

  test("skill trigger uses the pilot's matching item, or a plain d20", () => {
    const skill = { type: "skill", name: "Hack or Fix", system: { lid: "sk_hack_or_fix", curr_rank: 2 } };
    pilot.items = [skill];
    const plan = rollPlanFor(pilot, { kind: "skill", key: "sk_hack_or_fix", label: "Hack or Fix" });
    assert.equal(plan.roller, skill);
    assert.equal(plan.bonus, 4);
    const none = rollPlanFor(pilot, { kind: "skill", key: "sk_other", label: "Other" });
    assert.equal(none.roller, pilot);
    assert.equal(none.bonus, 0);
    assert.ok(none.path.startsWith("system.__"));
  });

  test("unmounted pilot rolls HASE itself", () => {
    const solo = new MockActor({ id: "soloAAAAAAAAAAAA", type: "pilot", system: { agi: 3 } });
    const plan = rollPlanFor(solo, { kind: "hase", key: "agi", label: "Agility" });
    assert.equal(plan.actor, solo);
    assert.equal(plan.bonus, 3);
  });
});

before(() => assert.equal(typeof relay.handleQuery, "function"));
