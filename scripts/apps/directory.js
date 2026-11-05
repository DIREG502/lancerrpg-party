/**
 * @file Actors sidebar integration (modelled on PF2e's party folders, adapted to Lancer).
 *
 * Parties are rendered as folder-like entries at the top of the Actors tab. Each lists its
 * members; pilots show callsign, License Level and their active mech, which is listed (and
 * draggable) under the pilot. Members can optionally be hidden from the rest of the directory.
 *
 * Implementation: the module subclasses whatever class is in CONFIG.ui.actors at init (so it
 * composes with other modules that do the same) and CONFIG.Actor.collection (to filter the tree).
 *
 * @module lancer-party/apps/directory
 */

import { LANCER, MODULE_ID, PARTY_TYPE, TEMPLATES } from "../constants.js";
import { activeMechOf, memberSnapshot, memberSubtitle } from "../logic/lancer.js";
import { collectContainedIds } from "../logic/members.js";
import { canManage } from "../relay.js";
import { SETTINGS, getSetting } from "../settings.js";
import { format, getActiveParty, getParties, guarded, isParty, localize, resolveActor } from "../util.js";
import * as actions from "../actions.js";

const PART = "lancerParties";

/** Keys whose change should re-render the directory (party membership, pilot details shown in it). */
const RENDER_KEYS = ["system.members", "system.level", "system.callsign", "system.active_mech", "system.pilot", "system.tier"];

/**
 * Ids of actors displayed inside visible parties (to hide them from the main tree).
 * @param {Actor[]} parties
 */
function containedIds(parties) {
  const includeMechs = !!getSetting(SETTINGS.SHOW_MECHS);
  return collectContainedIds(parties.map(p => {
    const members = p.system.memberActors.filter(a => a.visible);
    return {
      memberIds: members.map(a => a.id),
      mechIds: members.map(a => activeMechOf(a)).filter(m => m?.visible).map(m => m.id)
    };
  }), { includeMechs });
}

/**
 * Subclass the configured Actors collection so the directory tree omits parties (rendered in
 * their own part) and, if enabled, actors shown inside parties.
 * @param {typeof foundry.documents.collections.Actors} Base
 */
export function extendActorsCollection(Base) {
  return class LancerPartyActors extends Base {
    /** @override */
    _getVisibleTreeContents() {
      const contents = super._getVisibleTreeContents();
      const parties = contents.filter(isParty);
      if (!parties.length) return contents;
      const hidden = getSetting(SETTINGS.HIDE_MEMBERS) ? containedIds(parties) : new Set();
      return contents.filter(a => !isParty(a) && !hidden.has(a.id));
    }
  };
}

/**
 * @param {typeof foundry.applications.sidebar.tabs.ActorDirectory} Base
 */
export function extendActorDirectory(Base) {
  return class LancerPartyActorDirectory extends Base {
    static DEFAULT_OPTIONS = {
      actions: {
        lpToggleParty: LancerPartyActorDirectory.#onToggleParty,
        lpOpenParty: LancerPartyActorDirectory.#onOpenParty,
        lpActivateParty: LancerPartyActorDirectory.#onActivateParty,
        lpCreateParty: LancerPartyActorDirectory.#onCreateParty,
        lpCreateMember: LancerPartyActorDirectory.#onCreateMember
      }
    };

    static PARTS = { ...Base.PARTS, [PART]: { template: `${TEMPLATES}/sidebar/parties.hbs` } };

    /** @override */
    _initializeApplicationOptions(options) {
      const config = super._initializeApplicationOptions(options);
      config.renderUpdateKeys = [...new Set([...(config.renderUpdateKeys ?? []), ...RENDER_KEYS])];
      return config;
    }

    /** Per-client expanded state of party entries. */
    get #expanded() {
      return getSetting(SETTINGS.EXPANDED) ?? {};
    }

    async #setExpanded(partyId, value) {
      const state = { ...this.#expanded };
      if (value) state[partyId] = true;
      else delete state[partyId];
      await game.settings.set(MODULE_ID, SETTINGS.EXPANDED, state);
    }

    /** @override */
    render(options = {}, ...args) {
      // The parties part lives inside the directory part; always re-render them together.
      const parts = typeof options === "object" ? options?.parts : undefined;
      if (Array.isArray(parts)) {
        if (parts.includes(PART) && !parts.includes("directory")) parts.push("directory");
        if (parts.includes("directory") && !parts.includes(PART)) parts.push(PART);
      }
      return super.render(options, ...args);
    }

    /**
     * Membership changes are plain updates, which don't necessarily rebuild the tree; rebuild it
     * so members move in/out of the main list immediately.
     * @override
     */
    async _prepareContext(options) {
      if (!options?.parts || options.parts.includes("directory")) {
        try {
          this.collection.initializeTree?.();
        } catch (err) {
          console.error(`${MODULE_ID} | Could not rebuild the actor tree`, err);
        }
      }
      return super._prepareContext(options);
    }

    /** @override */
    async _preparePartContext(partId, context, options) {
      context = await super._preparePartContext(partId, context, options);
      if (partId !== PART) return context;
      const active = getActiveParty();
      const expanded = this.#expanded;
      const showMechs = !!getSetting(SETTINGS.SHOW_MECHS);
      const canCreate = game.user.can("ACTOR_CREATE");
      const fmt = (key, data) => format(key, data);
      const parties = getParties().filter(p => p.visible).sort((a, b) => (b === active) - (a === active));
      context.lancerParties = parties.map(party => {
        const members = party.system.memberActors.filter(a => a.visible).map(actor => {
          const snap = memberSnapshot(actor);
          const mech = showMechs && actor.type === LANCER.PILOT ? activeMechOf(actor) : null;
          return {
            id: actor.id,
            name: actor.name,
            img: actor.img,
            subtitle: memberSubtitle(snap, fmt),
            mech: mech?.visible ? { id: mech.id, name: mech.name, img: mech.img, frame: snap.mech?.frame } : null
          };
        });
        return {
          id: party.id,
          uuid: party.uuid,
          name: party.name,
          img: party.img,
          active: party === active,
          expanded: !!expanded[party.id],
          canManage: canManage(party),
          canCreateMember: canCreate && canManage(party),
          members,
          count: members.length
        };
      });
      context.lancerPartyIsGM = game.user.isGM;
      return context;
    }

    /** @override */
    async _onRender(context, options) {
      // Move the parties list into the directory list before the base class binds drag & drop.
      const partEl = this.parts?.[PART];
      const directory = this.parts?.directory;
      if (partEl && directory) {
        for (const stale of directory.querySelectorAll(":scope > .lancer-parties")) if (stale !== partEl) stale.remove();
        directory.prepend(partEl);
      }
      await super._onRender(context, options);
      this.#injectCreateButton();
    }

    /** Add a "Create Party" button to the directory header. */
    #injectCreateButton() {
      if (!game.user.can("ACTOR_CREATE")) return;
      const header = this.element.querySelector(".directory-header .header-actions") ?? this.element.querySelector(".directory-header");
      if (!header || header.querySelector(".lp-create-party")) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lp-create-party create-entry";
      button.dataset.action = "lpCreateParty";
      button.innerHTML = `<i class="fa-solid fa-people-group" inert></i> <span>${localize("LANCERPARTY.Sidebar.CreateParty")}</span>`;
      header.append(button);
    }

    /** @override  Keep party folders out of the Folder context menu. */
    _createContextMenus() {
      this._createContextMenu(this._getFolderContextOptions, ".folder:not([data-lp-party]) > .folder-header", {
        fixed: true,
        hookName: "getFolderContextOptions",
        parentClassHooks: false
      });
      this._createContextMenu(this._getEntryContextOptions, ".directory-item[data-entry-id]", {
        fixed: true,
        hookName: `get${this.documentName}ContextOptions`,
        parentClassHooks: false
      });
    }

    /** @override */
    _getEntryContextOptions() {
      const options = super._getEntryContextOptions();
      const actorOf = li => game.actors.get(li.dataset.entryId);
      const partyOfRow = li => {
        const row = li.closest("[data-lp-member]");
        return row ? game.actors.get(row.closest("[data-lp-party]")?.dataset.entryId) : null;
      };
      options.push(
        {
          name: "LANCERPARTY.Sidebar.SetActive",
          icon: '<i class="fa-solid fa-star"></i>',
          condition: li => game.user.isGM && isParty(actorOf(li)) && getActiveParty() !== actorOf(li),
          callback: li => actions.setActiveParty(actorOf(li))
        },
        {
          name: "LANCERPARTY.Sidebar.RemoveMember",
          icon: '<i class="fa-solid fa-user-minus"></i>',
          condition: li => {
            const party = partyOfRow(li);
            return !!party && canManage(party) && li.matches("[data-lp-member]");
          },
          callback: li => guarded(() => partyOfRow(li).system.removeMembers(actorOf(li)))
        },
        {
          name: "LANCERPARTY.Sidebar.AddToActive",
          icon: '<i class="fa-solid fa-user-plus"></i>',
          condition: li => {
            const actor = actorOf(li);
            const party = getActiveParty();
            if (!actor || !party || isParty(actor) || !canManage(party)) return false;
            if (![LANCER.PILOT, LANCER.MECH, LANCER.NPC].includes(actor.type)) return false;
            return !party.system.involves(actor);
          },
          callback: li => guarded(() => actions.addMembersWithFeedback(getActiveParty(), [actorOf(li)]))
        }
      );
      return options;
    }

    /** @override  Party entries stay visible when a member matches the search. */
    _onSearchFilter(event, query, rgx, html) {
      super._onSearchFilter(event, query, rgx, html);
      const expanded = this.#expanded;
      for (const li of html.querySelectorAll(".lancer-parties > li[data-lp-party]")) {
        if (!query) {
          li.style.display = "";
          for (const child of li.querySelectorAll(".directory-item")) child.style.display = "";
          li.classList.toggle("expanded", !!expanded[li.dataset.entryId]);
          continue;
        }
        const nameMatch = rgx.test(li.querySelector(".lp-party-name")?.textContent ?? "");
        const childMatch = [...li.querySelectorAll(".subdirectory .directory-item")].some(el => el.style.display !== "none");
        if (nameMatch) for (const child of li.querySelectorAll(".subdirectory .directory-item")) child.style.display = "";
        li.style.display = nameMatch || childMatch ? "" : "none";
        li.classList.toggle("expanded", childMatch || nameMatch);
      }
    }

    /** @override */
    collapseAll() {
      super.collapseAll();
      for (const el of this.element.querySelectorAll(".lancer-parties > li[data-lp-party]")) el.classList.remove("expanded");
      game.settings.set(MODULE_ID, SETTINGS.EXPANDED, {});
    }

    /** @override  Remember which party a member was dragged out of. */
    _onDragStart(event) {
      super._onDragStart(event);
      const li = event.target?.closest?.("[data-lp-member]");
      const partyId = li?.closest("[data-lp-party]")?.dataset.entryId;
      if (!partyId || !event.dataTransfer) return;
      try {
        const data = JSON.parse(event.dataTransfer.getData("text/plain"));
        data.lancerPartyFrom = game.actors.get(partyId)?.uuid;
        event.dataTransfer.setData("text/plain", JSON.stringify(data));
      } catch { /* not JSON drag data */ }
    }

    /** @override  Dropping onto a party adds; dragging a member out of its party removes. */
    async _handleDroppedEntry(target, data) {
      const partyEl = target?.closest?.("[data-lp-party]");
      const toParty = partyEl ? game.actors.get(partyEl.dataset.entryId) : null;
      if (data?.type === "Actor") {
        const fromParty = data.lancerPartyFrom ? await fromUuid(data.lancerPartyFrom) : null;
        if (toParty) {
          let actor = await getDocumentClass("Actor").fromDropData(data);
          if (!actor || actor === toParty || isParty(actor)) return;
          if (actor.pack) {
            // Import compendium actors first, like a normal directory drop.
            actor = await getDocumentClass("Actor").create(game.actors.fromCompendium(actor));
          }
          if (fromParty && fromParty !== toParty && canManage(fromParty)) await fromParty.system.removeMembers(actor);
          if (actor && !toParty.system.hasMember(actor)) await actions.addMembersWithFeedback(toParty, [actor]);
          return;
        }
        if (isParty(fromParty) && canManage(fromParty)) {
          const actor = await getDocumentClass("Actor").fromDropData(data);
          if (actor) await fromParty.system.removeMembers(actor);
        }
      }
      return super._handleDroppedEntry(target, data);
    }

    /* -------------------------------------------- */

    static async #onToggleParty(event, target) {
      const li = target.closest("[data-lp-party]");
      if (!li) return;
      const value = !li.classList.contains("expanded");
      li.classList.toggle("expanded", value);
      if (this.isPopout) this.setPosition();
      await this.#setExpanded(li.dataset.entryId, value);
    }

    static #onOpenParty(event, target) {
      event.stopPropagation();
      game.actors.get(target.closest("[data-lp-party]")?.dataset.entryId)?.sheet.render(true);
    }

    static #onActivateParty(event, target) {
      event.stopPropagation();
      return actions.setActiveParty(game.actors.get(target.closest("[data-lp-party]")?.dataset.entryId));
    }

    static async #onCreateParty(event) {
      event.stopPropagation();
      const party = await actions.createParty();
      if (party) {
        await this.#setExpanded(party.id, true);
        if (!game.settings.get(MODULE_ID, SETTINGS.ACTIVE_PARTY) && game.user.isGM) await actions.setActiveParty(party);
      }
    }

    static async #onCreateMember(event, target) {
      event.stopPropagation();
      const party = game.actors.get(target.closest("[data-lp-party]")?.dataset.entryId);
      if (!isParty(party)) return;
      const types = [LANCER.PILOT, LANCER.MECH, LANCER.NPC].filter(t => game.documentTypes.Actor.includes(t));
      const actor = await getDocumentClass("Actor").createDialog({}, {}, { types });
      if (actor) {
        await this.#setExpanded(party.id, true);
        await actions.addMembersWithFeedback(party, [actor]);
      }
    }
  };
}

export { PARTY_TYPE };
