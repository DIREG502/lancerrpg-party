/**
 * @file Settings registration and accessors.
 * @module lancer-party/settings
 */

import { MODULE_ID } from "./constants.js";

export const SETTINGS = Object.freeze({
  ACTIVE_PARTY: "activeParty",
  HIDE_MEMBERS: "hideMembers",
  SHOW_MECHS: "showMechsInSidebar",
  STATS_VISIBILITY: "statsVisibility",
  MEMBER_EDITING: "memberEditing",
  DEFAULT_OWNERSHIP: "defaultOwnership",
  AUTO_CREATE: "autoCreateParty",
  CREATED_FIRST: "createdFirstParty",
  EXPANDED: "expandedParties"
});

export const log = {
  info: (...args) => console.log(`${MODULE_ID} |`, ...args),
  warn: (...args) => console.warn(`${MODULE_ID} |`, ...args),
  error: (...args) => console.error(`${MODULE_ID} |`, ...args)
};

const rerenderDirectory = () => ui.actors?.render();

export function registerSettings() {
  const register = (key, data) => game.settings.register(MODULE_ID, key, data);
  const L = key => `LANCERPARTY.Settings.${key}`;

  register(SETTINGS.ACTIVE_PARTY, {
    scope: "world", config: false, type: String, default: "",
    onChange: () => {
      rerenderDirectory();
      for (const actor of game.actors ?? []) if (actor.sheet?.rendered && actor.type?.startsWith(MODULE_ID)) actor.sheet.render();
    }
  });

  register(SETTINGS.HIDE_MEMBERS, {
    name: L("HideMembers.Name"), hint: L("HideMembers.Hint"),
    scope: "world", config: true, type: Boolean, default: true, onChange: rerenderDirectory
  });

  register(SETTINGS.SHOW_MECHS, {
    name: L("ShowMechs.Name"), hint: L("ShowMechs.Hint"),
    scope: "world", config: true, type: Boolean, default: true, onChange: rerenderDirectory
  });

  register(SETTINGS.STATS_VISIBILITY, {
    name: L("StatsVisibility.Name"), hint: L("StatsVisibility.Hint"),
    scope: "world", config: true, type: String, default: "all",
    choices: { all: L("StatsVisibility.All"), observer: L("StatsVisibility.Observer") }
  });

  register(SETTINGS.MEMBER_EDITING, {
    name: L("MemberEditing.Name"), hint: L("MemberEditing.Hint"),
    scope: "world", config: true, type: Boolean, default: true
  });

  register(SETTINGS.DEFAULT_OWNERSHIP, {
    name: L("DefaultOwnership.Name"), hint: L("DefaultOwnership.Hint"),
    scope: "world", config: true, type: String, default: "observer",
    choices: { none: L("DefaultOwnership.None"), limited: L("DefaultOwnership.Limited"), observer: L("DefaultOwnership.Observer") }
  });

  register(SETTINGS.AUTO_CREATE, {
    name: L("AutoCreate.Name"), hint: L("AutoCreate.Hint"),
    scope: "world", config: true, type: Boolean, default: true
  });

  register(SETTINGS.CREATED_FIRST, { scope: "world", config: false, type: Boolean, default: false });

  register(SETTINGS.EXPANDED, { scope: "client", config: false, type: Object, default: {} });
}

/** @param {string} key */
export function getSetting(key) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch {
    return undefined;
  }
}

/** Ownership level (number) applied to newly created parties. */
export function defaultOwnershipLevel() {
  const levels = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  return { none: levels.NONE, limited: levels.LIMITED, observer: levels.OBSERVER }[getSetting(SETTINGS.DEFAULT_OWNERSHIP)] ?? levels.OBSERVER;
}
