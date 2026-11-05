/**
 * @file Shared constants. Contains no Foundry globals so it can be imported by unit tests.
 * @module lancer-party/constants
 */

export const MODULE_ID = "lancer-party";

/** Sub-type name as declared in module.json `documentTypes.Actor`. */
export const PARTY_SUBTYPE = "party";

/** Full actor type name. Foundry namespaces module-defined sub-types as `<moduleId>.<subtype>`. */
export const PARTY_TYPE = `${MODULE_ID}.${PARTY_SUBTYPE}`;

export const TEMPLATES = `modules/${MODULE_ID}/templates`;

export const PARTY_ICON = `modules/${MODULE_ID}/assets/party.svg`;

/** Query name registered in CONFIG.queries; executed on the active GM's client. */
export const QUERY_NAME = `${MODULE_ID}.request`;

/** Lancer actor type ids (see Lancer `EntryType`). */
export const LANCER = Object.freeze({
  PILOT: "pilot",
  MECH: "mech",
  NPC: "npc",
  DEPLOYABLE: "deployable"
});

/** Actor types that can be party members. Deployables belong to their owner, not to the squad. */
export const MEMBER_TYPES = Object.freeze([LANCER.PILOT, LANCER.MECH, LANCER.NPC]);

/** Lancer mech skills, in sheet order. Keys match `system.<key>` on pilots, mechs and NPCs. */
export const HASE = Object.freeze(["hull", "agi", "sys", "eng"]);

/** A Lancer check succeeds on a total of 10 or more. */
export const CHECK_TARGET = 10;

/** Lancer pilots cap at License Level 12. */
export const MAX_LICENSE_LEVEL = 12;

/** Clock sizes offered in the UI. Any integer between CLOCK_MIN and CLOCK_MAX is accepted. */
export const CLOCK_SIZES = Object.freeze([4, 6, 8, 10, 12]);
export const CLOCK_MIN = 2;
export const CLOCK_MAX = 20;

export const CLOCK_KINDS = Object.freeze(["progress", "threat"]);

export const MISSION_STATUSES = Object.freeze(["planning", "active", "complete", "failed"]);

export const MISSION_OUTCOMES = Object.freeze(["success", "partial", "failure"]);

/** Group check aggregation modes. */
export const CHECK_MODES = Object.freeze(["each", "all", "any", "majority"]);
