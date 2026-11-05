/**
 * @file TypeDataModel for the `lancer-party.party` actor sub-type.
 *
 * The actor document class is Lancer's `LancerActor` (the module doesn't replace it). LancerActor
 * calls a few things on every actor regardless of type; this model supplies safe values for them:
 *   - `update()` calls `this.system.full_update_data(data)`  → identity passthrough here.
 *   - `_markStatuses()` writes `this.system.statuses[id]`     → `statuses` object.
 *   - status → resistance mapping writes `system.resistances` → `resistances` object.
 *   - LancerTokenDocument sizes tokens from `actor.system.size` → `size = 1`.
 *
 * @module lancer-party/data/party-model
 */

import {
  CLOCK_KINDS, CLOCK_MAX, CLOCK_MIN, LANCER, MISSION_OUTCOMES, MISSION_STATUSES, PARTY_ICON
} from "../constants.js";
import { activeMechOf, pilotOf } from "../logic/lancer.js";
import { isWorldActorUuid, normalizeMembers, planAddMembers, planRemoveMembers } from "../logic/members.js";
import { resolveActor } from "../util.js";

const fields = foundry.data.fields;

const id = () => new fields.StringField({ required: true, blank: false, initial: () => foundry.utils.randomID() });
const text = (initial = "") => new fields.StringField({ required: true, blank: true, initial });

export class PartyModel extends foundry.abstract.TypeDataModel {
  /** Used by LancerActor.getDefaultArtwork for new parties. */
  static DEFAULT_ICON = PARTY_ICON;

  static defineSchema() {
    return {
      members: new fields.ArrayField(new fields.SchemaField({
        uuid: new fields.DocumentUUIDField({ type: "Actor", required: true, nullable: false }),
        role: text()
      })),
      description: new fields.HTMLField({ required: true, blank: true, initial: "" }),
      mission: new fields.SchemaField({
        number: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 1 }),
        name: text(),
        sitrep: text(),
        status: new fields.StringField({ required: true, choices: [...MISSION_STATUSES], initial: "planning" }),
        briefing: new fields.HTMLField({ required: true, blank: true, initial: "" })
      }),
      objectives: new fields.ArrayField(new fields.SchemaField({
        id: id(),
        text: text(),
        done: new fields.BooleanField({ initial: false }),
        hidden: new fields.BooleanField({ initial: false })
      })),
      clocks: new fields.ArrayField(new fields.SchemaField({
        id: id(),
        name: text(),
        segments: new fields.NumberField({ required: true, nullable: false, integer: true, min: CLOCK_MIN, max: CLOCK_MAX, initial: 4 }),
        value: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        kind: new fields.StringField({ required: true, choices: [...CLOCK_KINDS], initial: "progress" }),
        hidden: new fields.BooleanField({ initial: false })
      })),
      reserves: new fields.ArrayField(new fields.SchemaField({
        id: id(),
        name: text(),
        img: text(),
        itemType: text(),
        description: new fields.HTMLField({ required: true, blank: true, initial: "" }),
        quantity: new fields.NumberField({ required: true, nullable: false, integer: true, min: 1, initial: 1 }),
        itemData: new fields.ObjectField({ required: false, nullable: true, initial: null })
      })),
      manna: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
      log: new fields.ArrayField(new fields.SchemaField({
        id: id(),
        number: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        name: text(),
        sitrep: text(),
        outcome: new fields.StringField({ required: true, choices: [...MISSION_OUTCOMES], initial: "success" }),
        date: text(),
        notes: text()
      }))
    };
  }

  /** @override */
  static migrateData(source) {
    // Clamp clock values that may exceed a reduced segment count from older data.
    if (Array.isArray(source.clocks)) {
      for (const clock of source.clocks) {
        if (clock && Number.isFinite(clock.value) && Number.isFinite(clock.segments)) clock.value = Math.min(clock.value, clock.segments);
      }
    }
    return super.migrateData(source);
  }

  /** @override */
  prepareBaseData() {
    super.prepareBaseData?.();
    // Properties LancerActor and LancerTokenDocument read from any actor's system data.
    this.statuses = {};
    this.resistances = {};
    this.size = 1;
  }

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData?.();
    for (const clock of this.clocks) clock.value = Math.min(clock.value, clock.segments);
  }

  /**
   * LancerActor#update passes all update data through this. Lancer's own models use it to rebuild
   * arrays from source; party updates always send whole arrays, so pass data through unchanged.
   * @param {object} updateData
   * @returns {object}
   */
  full_update_data(updateData) {
    return updateData;
  }

  /* -------------------------------------------- */
  /*  Members                                     */
  /* -------------------------------------------- */

  /**
   * Member actors that currently exist, in party order. Resolved lazily (not during data
   * preparation) so world load order doesn't matter.
   * @returns {Actor[]}
   */
  get memberActors() {
    return this.members.map(m => resolveActor(m.uuid)).filter(Boolean);
  }

  /** Member UUIDs that no longer resolve (deleted actors). */
  get missingMembers() {
    return this.members.filter(m => !resolveActor(m.uuid)).map(m => m.uuid);
  }

  /** Active mechs of member pilots (plus mech members themselves). */
  get mechActors() {
    const result = [];
    for (const actor of this.memberActors) {
      if (actor.type === LANCER.MECH) result.push(actor);
      const mech = activeMechOf(actor);
      if (mech) result.push(mech);
    }
    return [...new Set(result)];
  }

  /** Pilots among members. */
  get pilots() {
    return this.memberActors.filter(a => a.type === LANCER.PILOT);
  }

  /**
   * Is the actor a member, or the active mech of a member pilot?
   * @param {Actor} actor
   */
  involves(actor) {
    if (!actor) return false;
    if (this.members.some(m => m.uuid === actor.uuid)) return true;
    if (actor.type === LANCER.MECH) {
      const pilot = pilotOf(actor);
      if (pilot && this.members.some(m => m.uuid === pilot.uuid)) return true;
      return this.pilots.some(p => activeMechOf(p) === actor);
    }
    return false;
  }

  /** @param {Actor} actor */
  hasMember(actor) {
    return !!actor && this.members.some(m => m.uuid === actor.uuid);
  }

  /**
   * Add actors as members (Lancer rules in {@link planAddMembers}). Requires permission to update the party.
   * @param {...Actor} actors
   * @returns {Promise<ReturnType<typeof planAddMembers>>}
   */
  async addMembers(...actors) {
    const candidates = actors.flat().filter(Boolean).map(actor => {
      const pilot = actor.type === LANCER.MECH ? pilotOf(actor) : null;
      return {
        uuid: actor.uuid,
        type: actor.type,
        pilotUuid: pilot && isWorldActorUuid(pilot.uuid) ? pilot.uuid : null
      };
    });
    const plan = planAddMembers(this._source.members, candidates);
    if (plan.added.length) await this.parent.update({ "system.members": plan.entries });
    return plan;
  }

  /**
   * @param {...(Actor|string)} actorsOrUuids
   * @returns {Promise<string[]>}  Removed UUIDs.
   */
  async removeMembers(...actorsOrUuids) {
    const uuids = actorsOrUuids.flat().map(a => (typeof a === "string" ? a : a?.uuid)).filter(Boolean);
    const plan = planRemoveMembers(this._source.members, uuids);
    if (plan.removed.length) await this.parent.update({ "system.members": plan.entries });
    return plan.removed;
  }

  /** Remove UUIDs that point to deleted actors. */
  async pruneMissing() {
    const missing = this.missingMembers;
    if (missing.length) await this.removeMembers(...missing);
    return missing;
  }

  /** Normalised copy of the stored member list (with roles). */
  get memberEntries() {
    return normalizeMembers(this._source.members);
  }
}
