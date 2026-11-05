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
