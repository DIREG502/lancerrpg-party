/**
 * Minimal stand-ins for the Foundry v13 globals the module touches at import time and in the
 * code paths under test. This is NOT a Foundry emulator: it only lets us exercise our own logic
 * (permissions, relay, data model helpers, tree filtering, template rendering) in Node.
 */

let idCounter = 0;
export const randomID = () => `mock${String(++idCounter).padStart(12, "0")}`;

class Field {
  constructor(...args) {
    this.args = args;
    this.options = args.find(a => a && typeof a === "object" && !(a instanceof Field)) ?? {};
    this.element = args.find(a => a instanceof Field);
    this.fields = args[0] && typeof args[0] === "object" && !(args[0] instanceof Field) && !("required" in args[0]) ? args[0] : undefined;
  }
}
const fieldNames = ["StringField", "NumberField", "BooleanField", "HTMLField", "ObjectField", "ArrayField", "SchemaField", "DocumentUUIDField"];
const fields = Object.fromEntries(fieldNames.map(n => [n, class extends Field {}]));

export class MockUser {
  constructor({ id, isGM = false, name = id } = {}) {
    this.id = id;
    this.isGM = isGM;
    this.name = name;
    this.queries = [];
  }
  get isActiveGM() {
    return this.isGM && globalThis.game.users.activeGM === this;
  }
  can() {
    return this.isGM;
  }
  async query(name, data) {
    this.queries.push({ name, data });
    return globalThis.CONFIG.queries[name]?.(data);
  }
}

export class MockActor {
  constructor({ id, type, name = id, system = {}, ownership = {}, img = `${id}.svg` }) {
    this.id = id;
    this.uuid = `Actor.${id}`;
    this.type = type;
    this.name = name;
    this.img = img;
    this.system = system;
    this.ownership = ownership;
    this.items = [];
    this.statuses = new Set();
    this.updates = [];
    this.visible = true;
  }
  testUserPermission(user, level) {
    if (user.isGM) return true;
    const levels = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };
    const have = this.ownership[user.id] ?? this.ownership.default ?? 0;
    return have >= levels[level];
  }
  get isOwner() {
    return this.testUserPermission(globalThis.game.user, "OWNER");
  }
  async update(changes, options) {
    this.updates.push({ changes, options });
    // Apply dotted top-level system keys so subsequent ops see the new state.
    for (const [key, value] of Object.entries(changes)) {
      if (key.startsWith("system.")) setPath(this.system._sourceRef ?? this.system, key.slice(7), value);
    }
    return this;
  }
}

function setPath(obj, path, value) {
  const parts = path.split(".");
  let target = obj;
  for (const p of parts.slice(0, -1)) target = target[p] ??= {};
  target[parts.at(-1)] = value;
}

/** Install globals. Call before importing module files. */
export function installFoundryMock({ settings = {} } = {}) {
  const store = { "lancer-party.memberEditing": true, "lancer-party.hideMembers": true, "lancer-party.showMechsInSidebar": true, ...settings };
  class Collection extends Map {
    filter(fn) { return [...this.values()].filter(fn); }
    find(fn) { return [...this.values()].find(fn); }
    some(fn) { return [...this.values()].some(fn); }
    map(fn) { return [...this.values()].map(fn); }
    get contents() { return [...this.values()]; }
    [Symbol.iterator]() { return this.values(); }
  }
  const users = new Collection();
  Object.defineProperty(users, "activeGM", { get: () => [...users.values()].find(u => u.isGM) ?? null, configurable: true });

  globalThis.Actor = MockActor;
  globalThis.CONFIG = { queries: {}, Actor: { typeLabels: {}, dataModels: {} }, Item: { typeLabels: {} }, statusEffects: [] };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 }, TOKEN_DISPOSITIONS: { FRIENDLY: 1 } };
  globalThis.Hooks = { on() {}, once() {}, call() { return true; }, callAll() {} };
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} }, actors: { render() {} } };
  globalThis.fromUuidSync = uuid => globalThis.game.actors.get(String(uuid).split(".").at(-1)) ?? null;
  globalThis.fromUuid = async uuid => globalThis.fromUuidSync(uuid);
  globalThis.foundry = {
    data: { fields },
    abstract: {
      TypeDataModel: class {
        toObject() { return JSON.parse(JSON.stringify(this._source)); }
      }
    },
    utils: { randomID, deepClone: v => JSON.parse(JSON.stringify(v)), isNewerVersion: () => false },
    applications: {
      api: {
        DialogV2: { confirm: async () => true, wait: async () => null },
        HandlebarsApplicationMixin: Base => class extends Base {}
      },
      sheets: { ActorSheetV2: class {} },
      handlebars: { renderTemplate: async () => "<div></div>", loadTemplates: async () => {} },
      ux: { TextEditor: { implementation: { enrichHTML: async h => h } } }
    }
  };
  globalThis.game = {
    i18n: { lang: "en", localize: k => k, format: (k, d) => `${k}${d ? JSON.stringify(d) : ""}`, has: () => false },
    settings: {
      get: (ns, key) => store[`${ns}.${key}`],
      set: async (ns, key, value) => { store[`${ns}.${key}`] = value; }
    },
    users,
    user: null,
    actors: new Collection(),
    messages: new Collection(),
    system: { id: "lancer", version: "3.1.3" },
    modules: new Collection()
  };
  return { store, users, Collection };
}

/** Register an actor in game.actors. */
export function addActor(actor) {
  globalThis.game.actors.set(actor.id, actor);
  return actor;
}

/** A pilot/mech pair linked the way Lancer 3.x prepares them. */
export function makePilotWithMech(pilotId, mechId, ownership = {}) {
  const pilot = new MockActor({ id: pilotId, type: "pilot", ownership, system: { level: 2, callsign: pilotId.toUpperCase(), grit: 1, hp: { value: 5, max: 6 } } });
  const mech = new MockActor({ id: mechId, type: "mech", ownership, system: { hp: { value: 10, max: 10 }, structure: { value: 4, max: 4 }, hull: 2, agi: 1 } });
  pilot.system.active_mech = { id: mech.uuid, status: "resolved", value: mech };
  mech.system.pilot = { id: pilot.uuid, status: "resolved", value: pilot };
  return { pilot, mech };
}
