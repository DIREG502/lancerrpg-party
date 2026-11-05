/**
 * @file Party mutations expressed as small operations.
 *
 * Every change that players may request (ticking a clock, taking a reserve, ...) is an operation
 * `{type, ...payload}`. The same function computes the update for an owner editing directly and
 * for the GM applying a relayed request, and it always works on the *current* data, so two
 * players editing different clocks at once don't overwrite each other.
 *
 * Pure: no Foundry globals. Randomness (ids) is injected.
 *
 * @module lancer-party/logic/ops
 */

import {
  CLOCK_KINDS, CLOCK_MAX, CLOCK_MIN, MAX_LICENSE_LEVEL, MISSION_OUTCOMES
} from "../constants.js";
import { normalizeMembers } from "./members.js";

/** Error raised for a refused or malformed operation. `code` maps to a localization key. */
export class PartyOpError extends Error {
  /**
   * @param {"denied"|"invalid"|"notFound"} code
   * @param {string} [message]
   */
  constructor(code, message) {
    super(message ?? code);
    this.name = "PartyOpError";
    this.code = code;
  }
}

/**
 * Operation types members (owners of a member actor) may request through the GM.
 * Anything else requires ownership of the party itself.
 */
export const MEMBER_OPS = Object.freeze(new Set([
  "clock.tick", "clock.add", "clock.update",
  "objective.add", "objective.toggle",
  "reserve.add", "reserve.remove", "reserve.adjust",
  "manna.adjust", "manna.set",
  "member.role"
]));

/** All known operation types. */
export const OP_TYPES = Object.freeze(new Set([
  ...MEMBER_OPS,
  "clock.delete", "clock.reset", "clock.move",
  "objective.update", "objective.delete", "objective.clear",
  "log.add", "log.delete"
]));

const clampInt = (value, min, max) => {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
};

const cleanText = (value, max = 200) => String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * @typedef {object} OpContext
 * @property {boolean} isOwner                    Requester owns the party (GM or owner).
 * @property {() => string} randomID              Id generator.
 * @property {(uuid: string) => boolean} [ownsMember]  Requester owns this member actor.
 * @property {string} [today]                     Date string for log entries.
 */

/**
 * Apply one operation to a copy of the party's system source.
 * @param {object} source  `party.system.toObject()` (or `_source.system`).
 * @param {object} op      Operation, e.g. `{type: "clock.tick", id, delta: 1}`.
 * @param {OpContext} ctx
 * @returns {{changes: Record<string, unknown>, result?: unknown}}  `changes` is suitable for `actor.update()`.
 * @throws {PartyOpError}
 */
export function applyOp(source, op, ctx) {
  if (!op || typeof op.type !== "string" || !OP_TYPES.has(op.type)) throw new PartyOpError("invalid", `Unknown operation ${op?.type}`);
  if (!ctx?.isOwner && !MEMBER_OPS.has(op.type)) throw new PartyOpError("denied");
  const isOwner = !!ctx.isOwner;
  const randomID = ctx.randomID;

  const [group] = op.type.split(".");
  switch (group) {
    case "clock": return clockOp(clone(source.clocks ?? []), op, isOwner, randomID);
    case "objective": return objectiveOp(clone(source.objectives ?? []), op, isOwner, randomID);
    case "reserve": return reserveOp(clone(source.reserves ?? []), op, randomID);
    case "manna": return mannaOp(source.manna ?? 0, op);
    case "member": return memberOp(clone(source.members ?? []), op, isOwner, ctx.ownsMember);
    case "log": return logOp(clone(source.log ?? []), op, randomID, ctx.today);
  }
  throw new PartyOpError("invalid");
}

/* -------------------------------------------- */

function findIndexOrThrow(list, id) {
  const index = list.findIndex(e => e.id === id);
  if (index < 0) throw new PartyOpError("notFound");
  return index;
}

function clockOp(clocks, op, isOwner, randomID) {
  const key = "system.clocks";
  switch (op.type) {
    case "clock.add": {
      const segments = clampInt(op.segments ?? 4, CLOCK_MIN, CLOCK_MAX);
      const clock = {
        id: randomID(),
        name: cleanText(op.name) || "",
        segments,
        value: clampInt(op.value ?? 0, 0, segments),
        kind: CLOCK_KINDS.includes(op.kind) ? op.kind : "progress",
        hidden: isOwner ? !!op.hidden : false
      };
      clocks.push(clock);
      return { changes: { [key]: clocks }, result: clock.id };
    }
    case "clock.tick": {
      const i = findIndexOrThrow(clocks, op.id);
      const clock = clocks[i];
      if (clock.hidden && !isOwner) throw new PartyOpError("denied");
      const delta = Math.trunc(Number(op.delta) || 0);
      clock.value = clampInt((clock.value ?? 0) + delta, 0, clock.segments);
      return { changes: { [key]: clocks }, result: clock.value };
    }
    case "clock.update": {
      const i = findIndexOrThrow(clocks, op.id);
      const clock = clocks[i];
      if (clock.hidden && !isOwner) throw new PartyOpError("denied");
      const c = op.changes ?? {};
      if ("name" in c) clock.name = cleanText(c.name);
      if ("segments" in c) {
        clock.segments = clampInt(c.segments, CLOCK_MIN, CLOCK_MAX);
        clock.value = Math.min(clock.value ?? 0, clock.segments);
      }
      if ("value" in c) clock.value = clampInt(c.value, 0, clock.segments);
      if ("kind" in c && CLOCK_KINDS.includes(c.kind)) clock.kind = c.kind;
      if ("hidden" in c) {
        if (!isOwner) throw new PartyOpError("denied");
        clock.hidden = !!c.hidden;
      }
      return { changes: { [key]: clocks } };
    }
    case "clock.delete": {
      const i = findIndexOrThrow(clocks, op.id);
      clocks.splice(i, 1);
      return { changes: { [key]: clocks } };
    }
    case "clock.reset": {
      for (const clock of clocks) clock.value = 0;
      return { changes: { [key]: clocks } };
    }
    case "clock.move": {
      const i = findIndexOrThrow(clocks, op.id);
      const [clock] = clocks.splice(i, 1);
      const to = clampInt(i + (Number(op.delta) || 0), 0, clocks.length);
      clocks.splice(to, 0, clock);
      return { changes: { [key]: clocks } };
    }
  }
  throw new PartyOpError("invalid");
}

function objectiveOp(objectives, op, isOwner, randomID) {
  const key = "system.objectives";
  switch (op.type) {
    case "objective.add": {
      const text = cleanText(op.text, 300);
      if (!text) throw new PartyOpError("invalid");
      const objective = { id: randomID(), text, done: false, hidden: isOwner ? !!op.hidden : false };
      objectives.push(objective);
      return { changes: { [key]: objectives }, result: objective.id };
    }
    case "objective.toggle": {
      const i = findIndexOrThrow(objectives, op.id);
      if (objectives[i].hidden && !isOwner) throw new PartyOpError("denied");
      objectives[i].done = "done" in op ? !!op.done : !objectives[i].done;
      return { changes: { [key]: objectives }, result: objectives[i].done };
    }
    case "objective.update": {
      const i = findIndexOrThrow(objectives, op.id);
      const c = op.changes ?? {};
      if ("text" in c) {
        const text = cleanText(c.text, 300);
        if (!text) throw new PartyOpError("invalid");
        objectives[i].text = text;
      }
      if ("hidden" in c) objectives[i].hidden = !!c.hidden;
      if ("done" in c) objectives[i].done = !!c.done;
      return { changes: { [key]: objectives } };
    }
    case "objective.delete": {
      const i = findIndexOrThrow(objectives, op.id);
      objectives.splice(i, 1);
      return { changes: { [key]: objectives } };
    }
    case "objective.clear": {
      const kept = op.onlyDone ? objectives.filter(o => !o.done) : [];
      return { changes: { [key]: kept } };
    }
  }
  throw new PartyOpError("invalid");
}

function reserveOp(reserves, op, randomID) {
  const key = "system.reserves";
  switch (op.type) {
    case "reserve.add": {
      const e = op.entry ?? {};
      const name = cleanText(e.name, 200);
      if (!name) throw new PartyOpError("invalid");
      const entry = {
        id: randomID(),
        name,
        img: typeof e.img === "string" ? e.img : "",
        itemType: typeof e.itemType === "string" ? e.itemType : "",
        description: typeof e.description === "string" ? e.description.slice(0, 20000) : "",
        quantity: clampInt(e.quantity ?? 1, 1, 999),
        itemData: e.itemData && typeof e.itemData === "object" ? clone(e.itemData) : null
      };
      reserves.push(entry);
      return { changes: { [key]: reserves }, result: entry.id };
    }
    case "reserve.remove": {
      const i = findIndexOrThrow(reserves, op.id);
      const [entry] = reserves.splice(i, 1);
      return { changes: { [key]: reserves }, result: entry };
    }
    case "reserve.adjust": {
      const i = findIndexOrThrow(reserves, op.id);
      const quantity = (reserves[i].quantity ?? 1) + Math.trunc(Number(op.delta) || 0);
      if (quantity <= 0) {
        const [entry] = reserves.splice(i, 1);
        return { changes: { [key]: reserves }, result: entry };
      }
      reserves[i].quantity = Math.min(quantity, 999);
      return { changes: { [key]: reserves }, result: reserves[i].quantity };
    }
  }
  throw new PartyOpError("invalid");
}

function mannaOp(current, op) {
  const key = "system.manna";
  const base = Math.max(0, Math.trunc(Number(current) || 0));
  const value = op.type === "manna.set"
    ? clampInt(op.value, 0, Number.MAX_SAFE_INTEGER)
    : Math.max(0, base + Math.trunc(Number(op.delta) || 0));
  return { changes: { [key]: value }, result: value };
}

function memberOp(members, op, isOwner, ownsMember) {
  if (op.type !== "member.role") throw new PartyOpError("invalid");
  const entries = normalizeMembers(members);
  const entry = entries.find(e => e.uuid === op.uuid);
  if (!entry) throw new PartyOpError("notFound");
  if (!isOwner && !ownsMember?.(op.uuid)) throw new PartyOpError("denied");
  entry.role = cleanText(op.role, 60);
  return { changes: { "system.members": entries } };
}

function logOp(log, op, randomID, today) {
  const key = "system.log";
  if (op.type === "log.add") {
    const e = op.entry ?? {};
    const entry = {
      id: randomID(),
      number: clampInt(e.number ?? 0, 0, 9999),
      name: cleanText(e.name, 200),
      sitrep: cleanText(e.sitrep, 100),
      outcome: MISSION_OUTCOMES.includes(e.outcome) ? e.outcome : "success",
      date: cleanText(e.date ?? today ?? "", 40),
      notes: cleanText(e.notes, 1000)
    };
    log.unshift(entry);
    return { changes: { [key]: log }, result: entry.id };
  }
  if (op.type === "log.delete") {
    const i = findIndexOrThrow(log, op.id);
    log.splice(i, 1);
    return { changes: { [key]: log } };
  }
  throw new PartyOpError("invalid");
}

/* -------------------------------------------- */

/**
 * Plan a License Level award for pilots. Returns only pilots whose level actually changes.
 * @param {Array<{uuid: string, level: number}>} pilots
 * @param {number} amount
 * @returns {Array<{uuid: string, from: number, to: number}>}
 */
export function planLicenseAward(pilots, amount = 1) {
  const delta = Math.trunc(Number(amount) || 0);
  const result = [];
  for (const pilot of pilots ?? []) {
    const from = clampInt(pilot.level ?? 0, 0, MAX_LICENSE_LEVEL);
    const to = clampInt(from + delta, 0, MAX_LICENSE_LEVEL);
    if (to !== from) result.push({ uuid: pilot.uuid, from, to });
  }
  return result;
}
