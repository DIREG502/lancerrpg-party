/**
 * @file Small Foundry-facing helpers shared by the rest of the module.
 * @module lancer-party/util
 */

import { MODULE_ID, PARTY_TYPE } from "./constants.js";
import { actorIdFromUuid } from "./logic/members.js";
import { SETTINGS, getSetting } from "./settings.js";

export const localize = key => game.i18n.localize(key);
export const format = (key, data) => game.i18n.format(key, data);

/** @param {Actor|null|undefined} actor */
export const isParty = actor => actor?.type === PARTY_TYPE;

/** @returns {Actor[]} All world party actors, sorted by `sort` then name. */
export function getParties() {
  return (game.actors?.filter(isParty) ?? [])
    .sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name, game.i18n.lang));
}

/** The world's active party, or the first party if the setting is empty/stale. */
export function getActiveParty() {
  const id = getSetting(SETTINGS.ACTIVE_PARTY);
  const actor = id ? game.actors?.get(id) : null;
  return isParty(actor) ? actor : (getParties()[0] ?? null);
}

/** Is this party the active party? */
export const isActiveParty = party => !!party && getActiveParty() === party;

/**
 * Resolve a stored member UUID to an actor without async lookups.
 * @param {string} uuid
 * @returns {Actor|null}
 */
export function resolveActor(uuid) {
  const id = actorIdFromUuid(uuid);
  if (id) return game.actors?.get(id) ?? null;
  try {
    const doc = fromUuidSync(uuid);
    return doc instanceof Actor ? doc : null;
  } catch {
    return null;
  }
}

/** Status effect icon/name lookup for status ids in `actor.statuses`. */
export function statusInfo(id) {
  const effect = CONFIG.statusEffects?.find(e => e.id === id);
  if (!effect) return undefined;
  return { img: effect.img ?? effect.icon, name: game.i18n.localize(effect.name ?? effect.label ?? id) };
}

/** Parties whose members (or members' mechs) include this actor. */
export function partiesInvolving(actor) {
  if (!actor) return [];
  return getParties().filter(p => p.system?.involves?.(actor));
}

/** The active GM user, if any, else null. */
export const activeGM = () => game.users?.activeGM ?? null;

/** Run `fn` and turn thrown errors into a notification + console error. */
export async function guarded(fn, contextKey = "LANCERPARTY.Error.Generic") {
  try {
    return await fn();
  } catch (err) {
    console.error(`${MODULE_ID} |`, err);
    const code = err?.code ? `LANCERPARTY.Error.Op.${err.code}` : null;
    const message = code && game.i18n.has(code) ? localize(code) : (err?.message || localize(contextKey));
    ui.notifications?.error(message);
    return undefined;
  }
}

/** Escape text for safe inclusion in HTML strings. */
export function escapeHTML(text) {
  return String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export const renderTemplate = (path, data) => foundry.applications.handlebars.renderTemplate(path, data);

/** Today's date as YYYY-MM-DD in the user's locale-independent form. */
export const today = () => new Date().toISOString().slice(0, 10);
