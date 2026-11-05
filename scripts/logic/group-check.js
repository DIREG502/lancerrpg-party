/**
 * @file Group check bookkeeping (who rolled what, did the squad succeed). Pure.
 *
 * Inspired by CoC7's combined roll card ("any/all must succeed"), adapted to Lancer: every check
 * is a d20 roll against 10, and the roll itself is performed by Lancer's own StatRollFlow so that
 * accuracy/difficulty and the system chat card behave exactly as for a normal check.
 *
 * @module lancer-party/logic/group-check
 */

import { CHECK_MODES, CHECK_TARGET, HASE } from "../constants.js";

/**
 * @typedef {object} CheckDescriptor
 * @property {"skill"|"hase"|"grit"|"flat"} kind
 * @property {string} key    Skill key (lid or slug), HASE key, or "" for grit/flat.
 * @property {string} label  Display label at the time of the request.
 */

/**
 * @typedef {object} CheckRow
 * @property {string} uuid          Member actor UUID.
 * @property {string} name
 * @property {string} img
 * @property {number|null} total    Roll total, null while pending.
 * @property {string|null} rollerUuid  Actor that actually rolled (e.g. the mech for HASE).
 */

/**
 * Stable key for a Lancer skill trigger item. Prefers the Lancer id (lid) so the same trigger
 * matches across pilots even if a player renamed it; falls back to a slug of the name.
 * @param {{name?: string, system?: {lid?: string}}} item
 * @returns {string}
 */
export function skillKey(item) {
  const lid = item?.system?.lid;
  if (typeof lid === "string" && lid.trim()) return lid.trim();
  return `name:${slugify(item?.name ?? "")}`;
}

/** @param {string} text */
export function slugify(text) {
  return String(text).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}

/**
 * Union of skill triggers across pilots, for the request dialog.
 * @param {Array<Array<{name: string, system?: {lid?: string, curr_rank?: number}}>>} skillLists  One list per pilot.
 * @returns {Array<{key: string, label: string, count: number}>}  Sorted by label.
 */
export function collectSkillOptions(skillLists) {
  const map = new Map();
  for (const list of skillLists ?? []) {
    const seenHere = new Set();
    for (const item of list ?? []) {
      const key = skillKey(item);
      if (seenHere.has(key)) continue;
      seenHere.add(key);
      const entry = map.get(key) ?? { key, label: item.name ?? key, count: 0 };
      entry.count += 1;
      map.set(key, entry);
    }
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Validate and normalise a check descriptor coming from a form or a chat flag.
 * @param {Partial<CheckDescriptor>} check
 * @returns {CheckDescriptor|null}
 */
export function normalizeCheck(check) {
  const kind = check?.kind;
  const label = String(check?.label ?? "").slice(0, 120);
  if (kind === "skill" && typeof check.key === "string" && check.key) return { kind, key: check.key, label };
  if (kind === "hase" && HASE.includes(check.key)) return { kind, key: check.key, label };
  if (kind === "grit" || kind === "flat") return { kind, key: "", label };
  return null;
}

/**
 * Parse the value of the check `<select>` in the request dialog ("skill:<key>", "hase:hull", "grit", "flat").
 * @param {string} value
 * @returns {{kind: string, key: string}|null}
 */
export function parseCheckValue(value) {
  if (typeof value !== "string" || !value) return null;
  const sep = value.indexOf(":");
  const kind = sep < 0 ? value : value.slice(0, sep);
  const key = sep < 0 ? "" : value.slice(sep + 1);
  const check = normalizeCheck({ kind, key, label: "" });
  return check ? { kind: check.kind, key: check.key } : null;
}

/**
 * Aggregate results.
 * @param {CheckRow[]} rows
 * @param {string} mode    One of CHECK_MODES.
 * @param {number} [target=CHECK_TARGET]
 * @returns {{total: number, rolled: number, pending: number, successes: number, failures: number,
 *            complete: boolean, outcome: "success"|"failure"|null}}
 *   `outcome` is null for mode "each" and while the outcome is still undecided.
 */
export function evaluateGroupCheck(rows, mode, target = CHECK_TARGET) {
  const list = rows ?? [];
  const rolled = list.filter(r => Number.isFinite(r.total));
  const successes = rolled.filter(r => r.total >= target).length;
  const failures = rolled.length - successes;
  const total = list.length;
  const pending = total - rolled.length;
  const complete = pending === 0;
  let outcome = null;
  const m = CHECK_MODES.includes(mode) ? mode : "each";
  if (m === "all") {
    if (failures > 0) outcome = "failure";
    else if (complete && total > 0) outcome = "success";
  } else if (m === "any") {
    if (successes > 0) outcome = "success";
    else if (complete) outcome = "failure";
  } else if (m === "majority") {
    const needed = Math.floor(total / 2) + 1;
    if (successes >= needed) outcome = "success";
    else if (successes + pending < needed) outcome = "failure";
  }
  return { total, rolled: rolled.length, pending, successes, failures, complete, outcome };
}

/**
 * Record a result for one row. Returns a new array; refuses unknown rows and, unless `allowReroll`,
 * rows that already have a result.
 * @param {CheckRow[]} rows
 * @param {string} uuid
 * @param {number} total
 * @param {{rollerUuid?: string|null, allowReroll?: boolean}} [options]
 * @returns {CheckRow[]|null}  null if nothing changed.
 */
export function recordResult(rows, uuid, total, { rollerUuid = null, allowReroll = false } = {}) {
  const index = (rows ?? []).findIndex(r => r.uuid === uuid);
  if (index < 0 || !Number.isFinite(Number(total))) return null;
  if (Number.isFinite(rows[index].total) && !allowReroll) return null;
  const next = rows.map(r => ({ ...r }));
  next[index].total = Number(total);
  next[index].rollerUuid = rollerUuid;
  return next;
}
