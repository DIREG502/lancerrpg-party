/**
 * @file Entry point for Lancer Party.
 *
 * Public API (also via `game.modules.get("lancer-party").api`):
 *   const lp = game.modules.get("lancer-party").api;
 *   const party = lp.getActiveParty();
 *   await lp.addMembers(party, game.user.character);
 *   await lp.requestGroupCheck(party, { check: "hase:agi", mode: "all", prompt: false });
 *
 * @module lancer-party/main
 */

import { MODULE_ID, PARTY_TYPE, QUERY_NAME, TEMPLATES } from "./constants.js";
import { PartyModel } from "./data/party-model.js";
import { PartySheet, refreshPartySheetsFor } from "./apps/party-sheet.js";
import { extendActorDirectory, extendActorsCollection } from "./apps/directory.js";
import { onRenderChatMessage, requestGroupCheck } from "./apps/group-check.js";
import { handleQuery, requestPartyOp } from "./relay.js";
import { SETTINGS, defaultOwnershipLevel, log, registerSettings } from "./settings.js";
import * as actions from "./actions.js";
import { getActiveParty, getParties, isParty, partiesInvolving } from "./util.js";
import * as membersLogic from "./logic/members.js";
import * as opsLogic from "./logic/ops.js";
import * as checkLogic from "./logic/group-check.js";
import * as lancerLogic from "./logic/lancer.js";

/** Lancer 3.0.0 is the first release with Foundry v13 support. */
const MIN_LANCER = "3.0.0";

let enabled = false;

export const api = {
  PARTY_TYPE,
  getParties,
  getActiveParty,
  setActiveParty: actions.setActiveParty,
  createParty: actions.createParty,
  addMembers: (party, ...actors) => actions.addMembersWithFeedback(party, actors.flat()),
  removeMembers: (party, ...actors) => party.system.removeMembers(...actors),
  openSheet: (party = getActiveParty()) => party?.sheet.render(true),
  requestGroupCheck,
  fullRepair: actions.fullRepair,
  awardLicenseLevel: actions.awardLicenseLevel,
  deploy: actions.deployParty,
  recall: actions.recallParty,
  addToCombat: actions.addPartyToCombat,
  postRoster: actions.postRoster,
  endMission: actions.endMission,
  stashItem: actions.stashItem,
  requestOp: requestPartyOp,
  logic: { members: membersLogic, ops: opsLogic, groupCheck: checkLogic, lancer: lancerLogic }
};

Hooks.once("init", () => {
  if (game.system.id !== "lancer") {
    log.warn("This module requires the Lancer system; it stays inactive.");
    return;
  }
  enabled = true;
  registerSettings();

  CONFIG.Actor.dataModels[PARTY_TYPE] = PartyModel;
  CONFIG.Actor.typeLabels ??= {};
  CONFIG.Actor.typeLabels[PARTY_TYPE] = "LANCERPARTY.TypeLabel";
  CONFIG.Actor.typeIcons ??= {};
  CONFIG.Actor.typeIcons[PARTY_TYPE] = "fa-solid fa-people-group";

  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, PartySheet, {
    types: [PARTY_TYPE],
    makeDefault: true,
    label: "LANCERPARTY.SheetLabel"
  });

  CONFIG.Actor.collection = extendActorsCollection(CONFIG.Actor.collection);
  CONFIG.ui.actors = extendActorDirectory(CONFIG.ui.actors);
  CONFIG.queries[QUERY_NAME] = handleQuery;

  foundry.applications.handlebars.loadTemplates([
    `${TEMPLATES}/sidebar/parties.hbs`,
    `${TEMPLATES}/sheet/header.hbs`,
    `${TEMPLATES}/sheet/squad.hbs`,
    `${TEMPLATES}/sheet/mission.hbs`,
    `${TEMPLATES}/sheet/reserves.hbs`,
    `${TEMPLATES}/sheet/notes.hbs`,
    `${TEMPLATES}/chat/group-check.hbs`,
    `${TEMPLATES}/chat/roster.hbs`,
    `${TEMPLATES}/dialogs/group-check.hbs`,
    `${TEMPLATES}/dialogs/deploy.hbs`,
    `${TEMPLATES}/dialogs/end-mission.hbs`
  ]);

  const module = game.modules.get(MODULE_ID);
  if (module) module.api = api;
});

/* -------------------------------------------- */
/*  Document hooks                              */
/* -------------------------------------------- */

Hooks.on("preCreateActor", (actor, data) => {
  if (!enabled || actor.type !== PARTY_TYPE) return;
  // Lancer's own _preCreate unlinks tokens for non-pilot/mech types; a party token should be linked.
  const changes = {
    "prototypeToken.actorLink": true,
    "prototypeToken.disposition": CONST.TOKEN_DISPOSITIONS.FRIENDLY
  };
  if (data.ownership?.default === undefined) changes["ownership.default"] = defaultOwnershipLevel();
  actor.updateSource(changes);
});

/** Re-render party sheets showing an actor whose data changed. */
function refreshFor(actor) {
  if (!enabled || !actor || isParty(actor)) return;
  const parties = partiesInvolving(actor);
  if (parties.length) refreshPartySheetsFor(actor, parties);
}

Hooks.on("updateActor", actor => refreshFor(actor));
for (const hook of ["createItem", "updateItem", "deleteItem", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
  Hooks.on(hook, doc => {
    if (doc.parent instanceof Actor) refreshFor(doc.parent);
  });
}

Hooks.on("deleteActor", (actor, options, userId) => {
  if (!enabled) return;
  const affected = getParties().filter(p => p.system.members.some(m => m.uuid === actor.uuid));
  for (const party of affected) {
    if (party.sheet?.rendered) party.sheet.render();
  }
  // One client (the active GM) cleans up memberships of deleted actors.
  if (game.user.isActiveGM) {
    for (const party of affected) party.system.removeMembers(actor.uuid).catch(err => log.error("Cleanup failed", err));
  }
});

Hooks.on("renderChatMessageHTML", (message, html) => {
  if (!enabled) return;
  try {
    onRenderChatMessage(message, html);
  } catch (err) {
    log.error("Failed to activate group check card", err);
  }
});

/* -------------------------------------------- */
/*  Ready                                       */
/* -------------------------------------------- */

Hooks.once("ready", async () => {
  if (!enabled) return;
  const version = game.system.version;
  if (version && foundry.utils.isNewerVersion(MIN_LANCER, version)) {
    ui.notifications.warn(game.i18n.format("LANCERPARTY.Error.OldLancer", { version, min: MIN_LANCER }));
  }
  await actions.createFirstParty();
  // The directory tree was built before parties could be resolved; refresh once.
  ui.actors?.render();
  Hooks.callAll(`${MODULE_ID}.ready`, api);
});

export { SETTINGS };
