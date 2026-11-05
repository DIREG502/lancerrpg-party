/**
 * Render every template with realistic context using Handlebars and stand-ins for the Foundry
 * helpers they use (localize, eq, ne, gt, and, or, not, disabled, selectOptions, formInput).
 * Catches runtime template errors and checks that key bits of markup appear.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Handlebars from "handlebars";

import { memberSnapshot, summarizeParty } from "../scripts/logic/lancer.js";
import { clockSegments } from "../scripts/logic/clock.js";
import { evaluateGroupCheck } from "../scripts/logic/group-check.js";

const hb = Handlebars.create();
const tpl = path => hb.compile(readFileSync(new URL(`../templates/${path}`, import.meta.url), "utf8"), { strict: false });

hb.registerHelper("localize", (key, options) => {
  const hash = options?.hash ?? {};
  return Object.keys(hash).length ? `${key}${JSON.stringify(hash)}` : key;
});
hb.registerHelper("eq", (a, b) => a === b);
hb.registerHelper("ne", (a, b) => a !== b);
hb.registerHelper("gt", (a, b) => a > b);
hb.registerHelper("not", a => !a);
hb.registerHelper("and", (...args) => args.slice(0, -1).every(Boolean));
hb.registerHelper("or", (...args) => args.slice(0, -1).some(Boolean));
hb.registerHelper("disabled", v => (v ? "disabled" : ""));
hb.registerHelper("selectOptions", (choices, options) => new hb.SafeString(
  choices.map(c => `<option value="${c[options.hash.valueAttr]}"${c[options.hash.valueAttr] === options.hash.selected ? " selected" : ""}>${c[options.hash.labelAttr]}</option>`).join("")
));
hb.registerHelper("formInput", (field, options) => {
  assert.ok(field, "formInput received a field");
  return new hb.SafeString(`<prose-mirror name="${options.hash.name}"></prose-mirror>`);
});

const pilot = {
  id: "p", uuid: "Actor.pppppppppppppppp", name: "Ada <script>", img: "p.svg", type: "pilot", statuses: new Set(),
  system: { callsign: "WRAITH", level: 3, grit: 2, hp: { value: 3, max: 6 } }
};
const mech = {
  id: "m", uuid: "Actor.mmmmmmmmmmmmmmmm", name: "Nightjar", img: "m.svg", type: "mech", statuses: new Set(),
  system: {
    hp: { value: 8, max: 10 }, heat: { value: 2, max: 6 }, structure: { value: 2, max: 4 }, stress: { value: 4, max: 4 },
    repairs: { value: 3, max: 4 }, core_energy: 0, overshield: { value: 2 }, burn: 1, evasion: 8,
    loadout: { frame: { status: "resolved", value: { name: "Everest" } } }, pilot: { id: "Actor.pppppppppppppppp", status: "resolved" }
  }
};
pilot.system.active_mech = { id: mech.uuid, status: "resolved", value: mech };
mech.system.pilot.value = pilot;

const snap = memberSnapshot(pilot);
const members = [
  { ...snap, index: 0, role: "Striker", canOpen: true, canOpenMech: true, canEditRole: true, restricted: false, typeLabel: "Pilot" },
  { ...memberSnapshot({ id: "n", uuid: "Actor.nnnnnnnnnnnnnnnn", name: "Ally", type: "npc", system: { tier: 2, hp: { value: 5, max: 5 } } }), index: 1, role: "", canOpen: false, restricted: true, typeLabel: "NPC" },
  { missing: true, uuid: "Actor.gggggggggggggggg", index: 2 }
];
const tabs = Object.fromEntries(["squad", "mission", "reserves", "notes"].map(id => [id, { id, cssClass: id === "squad" ? "active" : "", group: "primary" }]));
const base = {
  rootId: "sheet-1",
  party: { name: "Squad", img: "party.svg" },
  system: { mission: { number: 2, name: "Iron Gate", sitrep: "Holdout", status: "active" }, manna: 120 },
  sourceSystem: { mission: { briefing: "" }, description: "" },
  systemFields: { description: {}, mission: { fields: { briefing: {} } } },
  manage: true, contribute: true, editable: true, isGM: true, limited: false, isActive: false,
  members, hasMissing: true, summary: summarizeParty([snap]), tabs
};

describe("sheet templates render", () => {
  test("header: name, active flag, terminal readout, tab buttons", () => {
    const tabList = Object.values(tabs).map(t => ({ ...t, icon: "fa-solid fa-users", label: `LANCERPARTY.Tab.${t.id}` }));
    const html = tpl("sheet/header.hbs")({ ...base, tabs: tabList, missionStatusLabel: "Active" });
    assert.match(html, /data-action="setActive"/);
    assert.match(html, /class="lp-terminal"/);
    assert.equal((html.match(/data-action="tab"/g) ?? []).length, 4);
    assert.match(html, /lp-tab-button active" data-action="tab" data-group="primary" data-tab="squad"/);
  });

  test("sidebar: hex cluster, squad meters, permission-gated actions", () => {
    const ctx = { ...base, doneObjectives: 1, visibleObjectives: 3 };
    const gm = tpl("sheet/sidebar.hbs")(ctx);
    assert.equal((gm.match(/class="lp-hex /g) ?? []).length + (gm.match(/class="lp-hex"/g) ?? []).length, 4);
    assert.match(gm, /lp-meter lp-meter-hp" style="--lp-fill: 80%"/);
    for (const action of ["groupCheck", "deploy", "recall", "combat", "fullRepair", "awardLicense", "endMission", "roster"]) {
      assert.match(gm, new RegExp(`data-action="${action}"`), action);
    }
    const player = tpl("sheet/sidebar.hbs")({ ...ctx, manage: false, isGM: false, contribute: true });
    assert.deepEqual([...player.matchAll(/data-action="(\w+)"/g)].map(m => m[1]), ["combat", "roster"]);
  });

  test("squad: escapes names, shows mech data, hides restricted stats", () => {
    const html = tpl("sheet/squad.hbs")({ ...base, tab: tabs.squad });
    assert.ok(html.includes("Ada &lt;script&gt;"), "name escaped");
    assert.ok(!html.includes("<script>"));
    assert.match(html, /Everest/);
    assert.equal((html.match(/lp-pip filled/g) ?? []).length, 3, "repair pips");
    assert.match(html, /lp-meter lp-meter-structure" style="--lp-fill: 50%"/);
    assert.match(html, /lp-meter lp-meter-stress" style="--lp-fill: 100%"/);
    assert.match(html, /lp-hex-cluster-hase/);
    assert.match(html, /data-action="pruneMissing"/);
    // Restricted NPC: no telemetry for it, so exactly one stat line (the pilot's mech).
    assert.equal((html.match(/lp-statline-compact/g) ?? []).length, 1);
  });

  test("squad limited view", () => {
    const html = tpl("sheet/squad.hbs")({ ...base, limited: true, tab: tabs.squad });
    assert.match(html, /lp-limited-list/);
    assert.ok(!html.includes("lp-statline"));
  });

  test("mission", () => {
    const html = tpl("sheet/mission.hbs")({
      ...base, tab: tabs.mission,
      statuses: [{ value: "active", label: "Active" }, { value: "planning", label: "Planning" }],
      enrichedBriefing: "<p>Go</p>",
      objectives: [{ id: "o1", text: "Hold", done: true, hidden: true }],
      objectivesDone: 1,
      clocks: [{ id: "c1", name: "Reactor", segments: 6, value: 2, kind: "threat", hidden: false, full: false, segmentPaths: clockSegments(6, 2) }],
      clockSizes: [4, 6, 8],
      log: [{ id: "l1", number: 1, name: "First", sitrep: "Recon", outcome: "success", outcomeLabel: "Success", date: "2026-11-05", notes: "x" }]
    });
    assert.match(html, /<option value="active" selected>/);
    assert.equal((html.match(/class="lp-seg filled"/g) ?? []).length, 2);
    assert.match(html, /<option value="6" selected>6<\/option>/);
    assert.match(html, /prose-mirror name="system.mission.briefing"/);
    assert.match(html, /data-log-id="l1"/);
  });

  test("reserves and notes", () => {
    const html = tpl("sheet/reserves.hbs")({
      ...base, tab: tabs.reserves,
      reserves: [{ id: "r1", name: "Supply drop", img: "x.svg", typeLabel: "Reserve", quantity: 3, enriched: "<p>Ammo</p>" }],
      giveTargets: [{ uuid: pilot.uuid, name: "Ada" }]
    });
    assert.match(html, /class="lp-qty"[^>]*>3 </);
    assert.match(html, /data-action="reserveGive"/);
    const notes = tpl("sheet/notes.hbs")({ ...base, tab: tabs.notes, enrichedDescription: "" });
    assert.match(notes, /prose-mirror name="system.description"/);
    const readonly = tpl("sheet/notes.hbs")({ ...base, editable: false, tab: tabs.notes, enrichedDescription: "<p>n</p>" });
    assert.match(readonly, /lp-prose/);
  });
});

describe("sidebar, chat and dialog templates render", () => {
  test("sidebar parties", () => {
    const html = tpl("sidebar/parties.hbs")({
      lancerPartyIsGM: true,
      lancerParties: [
        { id: "a", uuid: "Actor.a", name: "Alpha", img: "a.svg", active: true, expanded: true, canCreateMember: true, count: 1,
          members: [{ id: "p", name: "Ada", img: "p.svg", subtitle: "WRAITH · LL 3", mech: { id: "m", name: "Nightjar", img: "m.svg", frame: "Everest" } }] },
        { id: "b", uuid: "Actor.b", name: "Bravo", img: "b.svg", active: false, expanded: false, count: 0, members: [] }
      ]
    });
    assert.match(html, /^<ol class="plain lancer-parties">/);
    assert.match(html, /data-entry-id="m"/);
    assert.match(html, /data-action="lpActivateParty"/);
    assert.match(html, /LANCERPARTY.Sidebar.Empty/);
    assert.equal((html.match(/data-lp-member/g) ?? []).length, 1);
  });

  test("group check card", () => {
    const rows = [{ uuid: "Actor.a", name: "A", img: "", total: 14 }, { uuid: "Actor.b", name: "B", img: "", total: null }];
    const flag = { title: "", check: { label: "Agility" }, mode: "all", target: 10, rows };
    const summary = evaluateGroupCheck(rows, "all");
    const html = tpl("chat/group-check.hbs")({
      flag, summary, modeLabel: "All", outcomeLabel: null,
      rows: rows.map(r => ({ ...r, rolled: Number.isFinite(r.total), success: r.total >= 10 }))
    });
    assert.match(html, /lp-check-row rolled success/);
    assert.match(html, /data-lp-roll/);
    assert.match(html, /pending&quot;:1/);
  });

  test("roster and dialogs", () => {
    assert.match(tpl("chat/roster.hbs")({ party: base.party, members: [snap] }), /Nightjar \(Everest\)/);
    const check = tpl("dialogs/group-check.hbs")({
      options: { hase: [{ value: "hase:hull", label: "Hull" }], skills: [], other: [{ value: "grit", label: "Grit" }] },
      modes: [{ value: "each", label: "Each" }], members: [{ uuid: "Actor.a", name: "A", img: "" }], selected: "hase:hull"
    });
    assert.match(check, /value="hase:hull" selected/);
    assert.match(check, /name="member-0"/);
    assert.match(tpl("dialogs/deploy.hbs")({ hasPartyToken: true }), /replacePartyToken/);
    assert.match(tpl("dialogs/end-mission.hbs")({ mission: base.system.mission, pilots: 2, outcomes: [{ value: "success", label: "S" }] }), /name="license"/);
  });
});
