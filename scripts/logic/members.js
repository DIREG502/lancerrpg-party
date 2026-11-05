/**
 * @file Pure membership rules. Works on plain descriptors so it can be unit tested without Foundry.
 * @module lancer-party/logic/members
 */

import { LANCER, MEMBER_TYPES, PARTY_TYPE } from "../constants.js";

/**
 * @typedef {object} MemberEntry  Stored member record (`system.members[]`).
 * @property {string} uuid  World actor UUID, e.g. "Actor.abc123".
 * @property {string} role  Free-text squad role ("Striker", "Support", ...).
 */

/**
 * @typedef {object} MemberCandidate  Describes an actor somebody tries to add.
 * @property {string} uuid
 * @property {string} type              Actor type.
 * @property {string|null} [pilotUuid]  For mechs: UUID of the bound pilot, if any.
 */

/**
 * Is this UUID a top-level world actor ("Actor.<id>")? Token actors, compendium entries and
 * embedded documents cannot be party members because they are not stable world references.
 * @param {string} uuid
 * @returns {boolean}
 */
export function isWorldActorUuid(uuid) {
  return typeof uuid === "string" && /^Actor\.[A-Za-z0-9]{16}$/.test(uuid);
}

/**
 * Extract the document id from a world actor UUID.
 * @param {string} uuid
 * @returns {string|null}
 */
export function actorIdFromUuid(uuid) {
  return isWorldActorUuid(uuid) ? uuid.slice(6) : null;
}

/**
 * Remove duplicates and malformed rows while keeping order and roles.
 * @param {Array<Partial<MemberEntry>>} entries
 * @returns {MemberEntry[]}
 */
export function normalizeMembers(entries) {
  const seen = new Set();
  const result = [];
  for (const entry of entries ?? []) {
    const uuid = entry?.uuid;
    if (!isWorldActorUuid(uuid) || seen.has(uuid)) continue;
    seen.add(uuid);
    result.push({ uuid, role: typeof entry.role === "string" ? entry.role : "" });
  }
  return result;
}

/**
 * Work out which candidates can join and what the resulting member list is.
 *
 * Lancer specifics: a mech that has a pilot is represented by that pilot (the mech is shown
 * under its pilot), so dropping a piloted mech adds the pilot instead. A mech without a pilot,
 * and NPC allies, can join directly. Deployables and other parties are refused.
 *
 * @param {Array<Partial<MemberEntry>>} existing
 * @param {MemberCandidate[]} candidates
 * @returns {{entries: MemberEntry[], added: string[], redirected: Array<{from: string, to: string}>,
 *            skipped: Array<{uuid: string, reason: "invalid"|"type"|"duplicate"}>}}
 */
export function planAddMembers(existing, candidates) {
  const entries = normalizeMembers(existing);
  const present = new Set(entries.map(e => e.uuid));
  const added = [];
  const redirected = [];
  const skipped = [];

  for (const candidate of candidates ?? []) {
    let uuid = candidate?.uuid;
    if (!isWorldActorUuid(uuid)) {
      skipped.push({ uuid: String(uuid), reason: "invalid" });
      continue;
    }
    if (candidate.type === PARTY_TYPE || !MEMBER_TYPES.includes(candidate.type)) {
      skipped.push({ uuid, reason: "type" });
      continue;
    }
    if (candidate.type === LANCER.MECH && isWorldActorUuid(candidate.pilotUuid)) {
      redirected.push({ from: uuid, to: candidate.pilotUuid });
      uuid = candidate.pilotUuid;
    }
    if (present.has(uuid)) {
      skipped.push({ uuid, reason: "duplicate" });
      continue;
    }
    present.add(uuid);
    entries.push({ uuid, role: "" });
    added.push(uuid);
  }
  return { entries, added, redirected, skipped };
}

/**
 * @param {Array<Partial<MemberEntry>>} existing
 * @param {string[]} uuids
 * @returns {{entries: MemberEntry[], removed: string[]}}
 */
export function planRemoveMembers(existing, uuids) {
  const remove = new Set(uuids ?? []);
  const entries = normalizeMembers(existing);
  const removed = entries.filter(e => remove.has(e.uuid)).map(e => e.uuid);
  return { entries: entries.filter(e => !remove.has(e.uuid)), removed };
}

/**
 * Move a member to a new index (drag-to-reorder on the sheet).
 * @param {Array<Partial<MemberEntry>>} existing
 * @param {string} uuid
 * @param {number} toIndex
 * @returns {MemberEntry[]}
 */
export function reorderMember(existing, uuid, toIndex) {
  const entries = normalizeMembers(existing);
  const from = entries.findIndex(e => e.uuid === uuid);
  if (from < 0) return entries;
  const [entry] = entries.splice(from, 1);
  const index = Math.max(0, Math.min(entries.length, Math.trunc(Number(toIndex) || 0)));
  entries.splice(index, 0, entry);
  return entries;
}

/**
 * Collect the ids of every actor a set of parties "contains": members plus, optionally,
 * the active mechs of member pilots. Used to hide them from the root of the Actors tab.
 * @param {Array<{memberIds: string[], mechIds: string[]}>} parties
 * @param {{includeMechs?: boolean}} [options]
 * @returns {Set<string>}
 */
export function collectContainedIds(parties, { includeMechs = true } = {}) {
  const ids = new Set();
  for (const party of parties ?? []) {
    for (const id of party.memberIds ?? []) ids.add(id);
    if (includeMechs) for (const id of party.mechIds ?? []) ids.add(id);
  }
  return ids;
}
