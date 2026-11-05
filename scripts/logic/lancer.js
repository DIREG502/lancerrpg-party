/**
 * @file Read-only adapter over Lancer actor data (system 3.x data models).
 *
 * Everything is duck-typed and null-safe so it survives partially prepared actors, missing
 * frames, broken pilot↔mech links, and future Lancer schema tweaks. No Foundry globals.
 *
 * Lancer's pilot↔mech link is two-way:
 *   pilot.system.active_mech → {id, status: "resolved"|"missing", value: LancerActor}
 *   mech.system.pilot        → {id, status, value}
 * Lancer only treats the pair as linked (e.g. for effect propagation) when both sides agree.
 *
 * @module lancer-party/logic/lancer
 */

import { HASE, LANCER } from "../constants.js";

/** @param {{value?: unknown, status?: string}|null|undefined} ref */
const resolved = ref => (ref && ref.status !== "missing" && ref.value ? ref.value : null);

/**
 * @param {object} pilot
 * @returns {object|null}  The pilot's active mech actor, if the reference resolves.
 */
export function activeMechOf(pilot) {
  if (pilot?.type !== LANCER.PILOT) return null;
  return resolved(pilot.system?.active_mech);
}

/**
 * @param {object} mech
 * @returns {object|null}  The mech's pilot actor, if the reference resolves.
 */
export function pilotOf(mech) {
  if (mech?.type !== LANCER.MECH) return null;
  return resolved(mech.system?.pilot);
}

/**
 * Do pilot and mech point at each other? (Lancer's "satisfied two-way binding".)
 * @param {object} pilot
 * @param {object} mech
 */
export function isMutualLink(pilot, mech) {
  if (!pilot || !mech) return false;
  return activeMechOf(pilot) === mech && (mech.system?.pilot?.id === pilot.uuid || pilotOf(mech) === pilot);
}

/**
 * @param {{value?: number, max?: number}|undefined} bar
 * @returns {{value: number, max: number, pct: number}|null}
 */
export function bar(bar) {
  if (!bar || typeof bar !== "object") return null;
  const value = Number(bar.value);
  const max = Number(bar.max);
  if (!Number.isFinite(value) || !Number.isFinite(max)) return null;
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  return { value, max, pct };
}

/**
 * Pips for small counters (structure, stress, repairs, core power).
 * @param {number} value
 * @param {number} max
 * @param {number} [cap=12]  Above this many, the UI shows numbers instead of pips.
 * @returns {Array<{filled: boolean}>|null}
 */
export function pips(value, max, cap = 12) {
  const v = Math.trunc(Number(value));
  const m = Math.trunc(Number(max));
  if (!Number.isFinite(v) || !Number.isFinite(m) || m <= 0 || m > cap) return null;
  return Array.from({ length: m }, (_, i) => ({ filled: i < v }));
}

const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * @param {object} actor
 * @param {(id: string) => {img?: string, name?: string}|undefined} [statusInfo]
 * @returns {Array<{id: string, img: string, label: string}>}
 */
export function statusList(actor, statusInfo) {
  const ids = actor?.statuses instanceof Set ? [...actor.statuses] : [];
  return ids.map(id => {
    const info = statusInfo?.(id) ?? {};
    return { id, img: info.img ?? "", label: info.name ?? id };
  }).filter(s => s.img);
}

/**
 * Combat-relevant mech data.
 * @param {object} mech
 * @param {(id: string) => object} [statusInfo]
 */
export function mechSnapshot(mech, statusInfo) {
  if (!mech) return null;
  const s = mech.system ?? {};
  const structure = bar(s.structure);
  const stress = bar(s.stress);
  const repairs = bar(s.repairs);
  return {
    id: mech.id,
    uuid: mech.uuid,
    name: mech.name,
    img: mech.img,
    type: mech.type,
    frame: s.loadout?.frame?.value?.name ?? null,
    hp: bar(s.hp),
    heat: bar(s.heat),
    overshield: num(s.overshield?.value) || 0,
    burn: num(s.burn) || 0,
    structure,
    structurePips: structure ? pips(structure.value, structure.max) : null,
    stress,
    stressPips: stress ? pips(stress.value, stress.max) : null,
    repairs,
    repairPips: repairs ? pips(repairs.value, repairs.max) : null,
    coreEnergy: num(s.core_energy),
    coreActive: !!s.core_active,
    overcharge: num(s.overcharge),
    tier: num(s.tier),
    stats: {
      evasion: num(s.evasion),
      edef: num(s.edef),
      armor: num(s.armor),
      speed: num(s.speed),
      sensors: num(s.sensor_range),
      save: num(s.save),
      techAttack: num(s.tech_attack),
      size: num(s.size)
    },
    hase: Object.fromEntries(HASE.map(k => [k, num(s[k])])),
    statuses: statusList(mech, statusInfo),
    destroyed: structure ? structure.value <= 0 : false
  };
}

/**
 * Full member view model for the party sheet and sidebar.
 * @param {object} actor  Pilot, mech or NPC.
 * @param {object} [options]
 * @param {(id: string) => object} [options.statusInfo]
 * @returns {object}
 */
export function memberSnapshot(actor, { statusInfo } = {}) {
  const s = actor?.system ?? {};
  const base = {
    id: actor.id,
    uuid: actor.uuid,
    name: actor.name,
    img: actor.img,
    type: actor.type,
    isPilot: actor.type === LANCER.PILOT,
    isMech: actor.type === LANCER.MECH,
    isNpc: actor.type === LANCER.NPC
  };
  if (actor.type === LANCER.PILOT) {
    const mech = activeMechOf(actor);
    return {
      ...base,
      callsign: s.callsign || "",
      playerName: s.player_name || "",
      level: num(s.level) ?? 0,
      grit: num(s.grit),
      hp: bar(s.hp),
      mounted: !!s.mounted,
      hase: Object.fromEntries(HASE.map(k => [k, num(s[k])])),
      statuses: statusList(actor, statusInfo),
      mech: mech ? mechSnapshot(mech, statusInfo) : null,
      mechLinked: mech ? isMutualLink(actor, mech) : false
    };
  }
  if (actor.type === LANCER.MECH) {
    // A mech member is one without a (resolvable) pilot; render it in the "mech" slot.
    return { ...base, callsign: "", playerName: "", level: null, mech: mechSnapshot(actor, statusInfo), mechLinked: false };
  }
  // NPC ally: it has the same combat stats shape as a mech.
  return { ...base, callsign: "", playerName: "", level: null, tier: num(s.tier), mech: mechSnapshot(actor, statusInfo), mechLinked: false };
}

/**
 * One-line subtitle for the sidebar ("CALLSIGN · LL 3 · Everest").
 * @param {object} snap  Result of {@link memberSnapshot}.
 * @param {(key: string, data?: object) => string} format  i18n formatter.
 * @returns {string}
 */
export function memberSubtitle(snap, format) {
  const parts = [];
  if (snap.isPilot) {
    if (snap.callsign) parts.push(snap.callsign);
    parts.push(format("LANCERPARTY.Member.LL", { level: snap.level ?? 0 }));
    if (snap.mech) parts.push(snap.mech.frame ? `${snap.mech.name} (${snap.mech.frame})` : snap.mech.name);
  } else if (snap.isMech) {
    parts.push(snap.mech?.frame ?? format("LANCERPARTY.Member.Mech"));
  } else if (snap.isNpc) {
    parts.push(snap.tier ? format("LANCERPARTY.Member.NpcTier", { tier: snap.tier }) : format("LANCERPARTY.Member.Npc"));
  }
  return parts.join(" · ");
}

/**
 * Party-level numbers shown in the summary strip.
 * @param {object[]} snaps  Member snapshots.
 */
export function summarizeParty(snaps) {
  const pilots = snaps.filter(m => m.isPilot);
  const levels = pilots.map(p => p.level ?? 0);
  const mechs = snaps.map(m => m.mech).filter(Boolean);
  const sum = (list, f) => list.reduce((acc, x) => acc + (f(x) ?? 0), 0);
  return {
    members: snaps.length,
    pilots: pilots.length,
    mechs: mechs.length,
    averageLL: levels.length ? Math.round((sum(levels, x => x) / levels.length) * 10) / 10 : null,
    minLL: levels.length ? Math.min(...levels) : null,
    maxLL: levels.length ? Math.max(...levels) : null,
    structure: sum(mechs, m => m.structure?.value),
    structureMax: sum(mechs, m => m.structure?.max),
    repairs: sum(mechs, m => m.repairs?.value),
    repairsMax: sum(mechs, m => m.repairs?.max),
    damaged: mechs.filter(m => (m.hp && m.hp.value < m.hp.max) || (m.structure && m.structure.value < m.structure.max)).length,
    destroyed: mechs.filter(m => m.destroyed).length
  };
}

/**
 * Which actor should be on the map for this member?
 * @param {object} actor  Member actor.
 * @param {"auto"|"mech"|"pilot"} mode
 * @returns {object|null}
 */
export function deployableActorFor(actor, mode = "auto") {
  if (!actor) return null;
  if (actor.type !== LANCER.PILOT) return actor;
  const mech = activeMechOf(actor);
  if (mode === "pilot") return actor;
  if (mode === "mech") return mech;
  return mech ?? actor;
}

/**
 * Token footprint in grid units. Lancer size ½ (pilots, small drones) still takes one cell.
 * @param {object} actor
 * @returns {number}
 */
export function tokenSize(actor) {
  const size = Number(actor?.system?.size);
  if (Number.isFinite(size) && size > 0) return Math.max(1, Math.round(size));
  const width = Number(actor?.prototypeToken?.width);
  return Number.isFinite(width) && width > 0 ? Math.max(1, Math.round(width)) : 1;
}
