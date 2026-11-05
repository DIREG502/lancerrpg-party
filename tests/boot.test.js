/**
 * Boot smoke test: import the entry point against the Foundry mock, run the captured `init`
 * hook and check what gets registered. Proves the module graph evaluates and wires up; it does
 * not prove the registrations behave correctly inside Foundry.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { installFoundryMock, MockActor } from "./helpers/foundry-mock.js";

installFoundryMock();
const hooks = { once: {}, on: {} };
globalThis.Hooks = {
  once: (name, fn) => ((hooks.once[name] ??= []).push(fn)),
  on: (name, fn) => ((hooks.on[name] ??= []).push(fn)),
  call: () => true,
  callAll: () => {}
};
const registered = [];
const loaded = [];
foundry.applications.apps = { DocumentSheetConfig: { registerSheet: (...args) => registered.push(args) } };
foundry.applications.handlebars.loadTemplates = list => loaded.push(...list);
const settings = [];
game.settings.register = (ns, key, data) => settings.push({ ns, key, data });
class BaseDirectory { static PARTS = { header: {}, directory: {}, footer: {} }; static DEFAULT_OPTIONS = {}; }
class BaseActors { _getVisibleTreeContents() { return []; } }
CONFIG.ui = { actors: BaseDirectory };
CONFIG.Actor.collection = BaseActors;
CONFIG.Actor.typeIcons = {};
game.modules.set("lancer-party", { id: "lancer-party" });

const main = await import("../scripts/main.js");
const { PARTY_TYPE, QUERY_NAME } = await import("../scripts/constants.js");

test("entry point registers its hooks at import", () => {
  for (const name of ["init", "ready"]) assert.ok(hooks.once[name]?.length, `once:${name}`);
  for (const name of ["preCreateActor", "updateActor", "deleteActor", "renderChatMessageHTML", "createItem", "deleteActiveEffect"]) {
    assert.ok(hooks.on[name]?.length, `on:${name}`);
  }
});

test("init wires data model, sheet, sidebar, collection, query, templates, settings, API", () => {
  for (const fn of hooks.once.init) fn();
  assert.ok(CONFIG.Actor.dataModels[PARTY_TYPE], "data model");
  assert.equal(CONFIG.Actor.typeLabels[PARTY_TYPE], "LANCERPARTY.TypeLabel");
  assert.equal(registered.length, 1);
  const [docClass, scope, sheet, options] = registered[0];
  assert.equal(docClass, MockActor);
  assert.equal(scope, "lancer-party");
  assert.equal(sheet.name, "PartySheet");
  assert.deepEqual(options.types, [PARTY_TYPE]);
  assert.notEqual(CONFIG.ui.actors, BaseDirectory);
  assert.ok(Object.prototype.isPrototypeOf.call(BaseDirectory, CONFIG.ui.actors), "directory subclasses the previous class");
  assert.deepEqual(Object.keys(CONFIG.ui.actors.PARTS), ["header", "directory", "footer", "lancerParties"]);
  assert.ok(Object.prototype.isPrototypeOf.call(BaseActors, CONFIG.Actor.collection));
  assert.equal(typeof CONFIG.queries[QUERY_NAME], "function");
  assert.equal(loaded.length, 12);
  assert.deepEqual(settings.map(s => s.key).sort(), [
    "activeParty", "autoCreateParty", "createdFirstParty", "defaultOwnership", "expandedParties",
    "hideMembers", "memberEditing", "showMechsInSidebar", "statsVisibility"
  ]);
  assert.equal(game.modules.get("lancer-party").api, main.api);
});

test("preCreateActor links the party token and applies default ownership", () => {
  const sourceUpdates = [];
  const doc = { type: PARTY_TYPE, updateSource: c => sourceUpdates.push(c) };
  game.settings.get = (ns, key) => (key === "defaultOwnership" ? "limited" : undefined);
  for (const fn of hooks.on.preCreateActor) fn(doc, {});
  assert.deepEqual(sourceUpdates[0], { "prototypeToken.actorLink": true, "prototypeToken.disposition": 1, "ownership.default": 1 });
  sourceUpdates.length = 0;
  for (const fn of hooks.on.preCreateActor) fn(doc, { ownership: { default: 0 } });
  assert.equal("ownership.default" in sourceUpdates[0], false, "explicit ownership is kept");
  for (const fn of hooks.on.preCreateActor) fn({ type: "pilot", updateSource: () => assert.fail("pilot touched") }, {});
});

test("sheet tab action switches tabs from any click inside the header buttons", async () => {
  const { PartySheet } = await import("../scripts/apps/party-sheet.js");
  const { lpTab, lpEditImage, revokeLicense } = PartySheet.DEFAULT_OPTIONS.actions;
  assert.equal(typeof revokeLicense, "function");
  const anchors = ["squad", "mission", "reserves", "notes"].map(tab => ({
    dataset: { tab }, cls: new Set(tab === "squad" ? ["active"] : []), attrs: {},
    classList: { toggle(c, on) { on ? this.owner.cls.add(c) : this.owner.cls.delete(c); } },
    setAttribute(k, v) { this.attrs[k] = v; }
  }));
  for (const a of anchors) a.classList.owner = a;
  const nav = { querySelectorAll: () => anchors };
  const calls = [];
  const app = { tabGroups: { primary: "squad" }, changeTab: (...args) => calls.push(args), element: { querySelectorAll: () => [] } };
  const target = { dataset: { tab: "mission", group: "primary" }, closest: () => nav };
  lpTab.call(app, { preventDefault() {} }, target);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ["mission", "primary"]);
  assert.equal(calls[0][2].navElement, nav);
  assert.deepEqual(anchors.map(a => a.cls.has("active")), [false, true, false, false]);
  assert.equal(anchors[1].attrs["aria-selected"], "true");

  // Fallback when changeTab throws: classes on the tab sections are toggled directly.
  const sections = ["squad", "reserves"].map(tab => ({ dataset: { tab }, on: false, classList: { toggle(_c, v) { this.s.on = v; } } }));
  for (const sct of sections) sct.classList.s = sct;
  const broken = { tabGroups: { primary: "squad" }, changeTab() { throw new Error("nope"); }, element: { querySelectorAll: () => sections } };
  const warn = console.warn;
  console.warn = () => {};
  lpTab.call(broken, { preventDefault() {} }, { dataset: { tab: "reserves", group: "primary" }, closest: () => nav });
  console.warn = warn;
  assert.equal(broken.tabGroups.primary, "reserves");
  assert.deepEqual(sections.map(sct => sct.on), [false, true]);

  // Image: opens a FilePicker for images and saves the chosen path on the party.
  let picker;
  CONFIG.ux = { FilePicker: class { constructor(o) { this.o = o; picker = this; } browse() { return "browsing"; } } };
  const updates = [];
  const sheet = { isEditable: true, document: { _source: { img: "old.svg" }, update: async d => updates.push(d) } };
  assert.equal(await lpEditImage.call(sheet), "browsing");
  assert.equal(picker.o.type, "image");
  assert.equal(picker.o.current, "old.svg");
  await picker.o.callback("new.webp");
  assert.deepEqual(updates, [{ img: "new.webp" }]);
  assert.equal(await lpEditImage.call({ ...sheet, isEditable: false }), undefined);
});
