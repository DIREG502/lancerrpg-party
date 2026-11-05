/**
 * @file The party actor sheet (ApplicationV2).
 *
 * Tabs: Squad (pilots, their mechs and NPC allies with live combat status), Mission (current
 * mission, objectives, progress/threat clocks, mission log), Reserves (shared reserves and manna),
 * Notes. Owners edit through the form; contributing members (players who own a member) act
 * through buttons that go through the GM relay.
 *
 * @module lancer-party/apps/party-sheet
 */

import { CLOCK_SIZES, LANCER, MISSION_STATUSES, MODULE_ID, TEMPLATES } from "../constants.js";
import { clockSegments } from "../logic/clock.js";
import { memberSnapshot, summarizeParty } from "../logic/lancer.js";
import { reorderMember } from "../logic/members.js";
import { canContribute, canManage, requestPartyOp } from "../relay.js";
import { SETTINGS, getSetting } from "../settings.js";
import {
  escapeHTML, format, guarded, isActiveParty, localize, resolveActor, statusInfo
} from "../util.js";
import * as actions from "../actions.js";
import { requestGroupCheck } from "./group-check.js";

const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TextEditor = () => foundry.applications.ux.TextEditor.implementation;

export class PartySheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["lancer-party", "lancer-party-sheet"],
    position: { width: 920, height: 820 },
    window: { resizable: true, icon: "fa-solid fa-people-group" },
    form: { submitOnChange: true },
    actions: {
      openMember: PartySheet.#onOpenMember,
      removeMember: PartySheet.#onRemoveMember,
      pruneMissing: PartySheet.#onPruneMissing,
      setActive: PartySheet.#onSetActive,
      groupCheck: PartySheet.#onGroupCheck,
      fullRepair: PartySheet.#onFullRepair,
      awardLicense: PartySheet.#onAwardLicense,
      deploy: PartySheet.#onDeploy,
      recall: PartySheet.#onRecall,
      combat: PartySheet.#onCombat,
      roster: PartySheet.#onRoster,
      endMission: PartySheet.#onEndMission,
      clockAdd: PartySheet.#onClockAdd,
      clockTick: { handler: PartySheet.#onClockTick, buttons: [0, 2] },
      clockDelete: PartySheet.#onClockDelete,
      clockHide: PartySheet.#onClockHide,
      clockReset: PartySheet.#onClockReset,
      objectiveAdd: PartySheet.#onObjectiveAdd,
      objectiveToggle: PartySheet.#onObjectiveToggle,
      objectiveDelete: PartySheet.#onObjectiveDelete,
      objectiveHide: PartySheet.#onObjectiveHide,
      reserveGive: PartySheet.#onReserveGive,
      reserveDelete: PartySheet.#onReserveDelete,
      reserveAdjust: PartySheet.#onReserveAdjust,
      reservePost: PartySheet.#onReservePost,
      reserveAddCustom: PartySheet.#onReserveAddCustom,
      mannaAdjust: PartySheet.#onMannaAdjust,
      logDelete: PartySheet.#onLogDelete
    }
  };

  static PARTS = {
    header: { template: `${TEMPLATES}/sheet/header.hbs` },
    sidebar: { template: `${TEMPLATES}/sheet/sidebar.hbs`, scrollable: [""] },
    squad: { template: `${TEMPLATES}/sheet/squad.hbs`, scrollable: [""] },
    mission: { template: `${TEMPLATES}/sheet/mission.hbs`, scrollable: [""] },
    reserves: { template: `${TEMPLATES}/sheet/reserves.hbs`, scrollable: [""] },
    notes: { template: `${TEMPLATES}/sheet/notes.hbs`, scrollable: [""] }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "squad", icon: "fa-solid fa-users" },
        { id: "mission", icon: "fa-solid fa-crosshairs" },
        { id: "reserves", icon: "fa-solid fa-boxes-stacked" },
        { id: "notes", icon: "fa-solid fa-book-open" }
      ],
      initial: "squad",
      labelPrefix: "LANCERPARTY.Tab"
    }
  };

  /** The party actor. */
  get party() {
    return this.document;
  }

  /** Users with only Limited permission see names and portraits only. */
  get isLimitedView() {
    return !this.document.testUserPermission(game.user, "OBSERVER");
  }

  /** @override */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    if (this.isLimitedView) {
      delete parts.sidebar;
      delete parts.mission;
      delete parts.reserves;
      delete parts.notes;
    }
    return parts;
  }

  /** @override */
  _prepareTabs(group) {
    const tabs = super._prepareTabs(group);
    if (group === "primary" && this.isLimitedView) {
      for (const id of ["mission", "reserves", "notes"]) delete tabs[id];
      if (tabs.squad) {
        tabs.squad.active = true;
        tabs.squad.cssClass = "active";
      }
    }
    return tabs;
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const party = this.document;
    const system = party.system;
    const user = game.user;
    const manage = canManage(party);
    const contribute = canContribute(party);
    const statsForAll = getSetting(SETTINGS.STATS_VISIBILITY) === "all";

    const members = system.memberEntries.map((entry, index) => {
      const actor = resolveActor(entry.uuid);
      if (!actor) return { missing: true, uuid: entry.uuid, index };
      const snap = memberSnapshot(actor, { statusInfo });
      const mechActor = snap.isPilot && snap.mech ? resolveActor(snap.mech.uuid) ?? null : null;
      const observer = actor.testUserPermission(user, "OBSERVER");
      return {
        ...snap,
        index,
        role: entry.role,
        canOpen: actor.testUserPermission(user, "LIMITED"),
        canOpenMech: !!mechActor?.testUserPermission(user, "LIMITED"),
        owner: actor.isOwner,
        canEditRole: manage || actor.isOwner,
        restricted: !(user.isGM || observer || statsForAll),
        typeLabel: localize(CONFIG.Actor.typeLabels?.[actor.type] ?? actor.type)
      };
    });
    const present = members.filter(m => !m.missing);

    Object.assign(context, {
      rootId: context.rootId ?? this.id,
      party,
      system,
      sourceSystem: party._source.system,
      systemFields: system.schema.fields,
      manage,
      contribute,
      editable: this.isEditable,
      isGM: user.isGM,
      limited: this.isLimitedView,
      isActive: isActiveParty(party),
      members,
      hasMissing: members.some(m => m.missing),
      summary: summarizeParty(present),
      missionStatusLabel: localize(`LANCERPARTY.MissionStatus.${system.mission.status}`),
      visibleObjectives: system.objectives.filter(o => manage || !o.hidden).length,
      doneObjectives: system.objectives.filter(o => (manage || !o.hidden) && o.done).length,
      tabs: this._prepareTabs("primary")
    });
    return context;
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (context.tabs?.[partId]) context.tab = context.tabs[partId];
    const party = this.document;
    const system = party.system;
    const manage = context.manage;
    const enrich = html => TextEditor().enrichHTML(html ?? "", { secrets: party.isOwner, relativeTo: party, rollData: {} });

    switch (partId) {
      case "mission": {
        context.statuses = MISSION_STATUSES.map(value => ({ value, label: localize(`LANCERPARTY.MissionStatus.${value}`) }));
        context.enrichedBriefing = await enrich(system.mission.briefing);
        context.objectives = system.objectives.filter(o => manage || !o.hidden);
        context.objectivesDone = context.objectives.filter(o => o.done).length;
        context.clocks = system.clocks.filter(c => manage || !c.hidden).map(c => ({
          ...c,
          segmentPaths: clockSegments(c.segments, c.value),
          full: c.value >= c.segments,
          kindLabel: localize(`LANCERPARTY.Clock.Kind.${c.kind}`)
        }));
        context.clockSizes = CLOCK_SIZES;
        context.log = system.log.map(e => ({ ...e, outcomeLabel: localize(`LANCERPARTY.Outcome.${e.outcome}`) }));
        break;
      }
      case "reserves": {
        context.reserves = await Promise.all(system.reserves.map(async r => ({
          ...r,
          typeLabel: r.itemType ? localize(CONFIG.Item.typeLabels?.[r.itemType] ?? r.itemType) : localize("LANCERPARTY.Reserves.Custom"),
          enriched: await enrich(r.description),
          img: r.img || "icons/svg/item-bag.svg"
        })));
        context.giveTargets = this.#giveTargets();
        break;
      }
      case "notes": {
        context.enrichedDescription = await enrich(system.description);
        break;
      }
    }
    return context;
  }

  /** Actors the current user may hand reserves to. */
  #giveTargets() {
    return this.document.system.memberActors
      .filter(a => a.type === LANCER.PILOT && a.isOwner)
      .map(a => ({ uuid: a.uuid, name: a.name }));
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const html = this.element;
    html.classList.toggle("lp-limited", this.isLimitedView);
    this.#bindMemberDrag(html);
    // Inline edits that map to operations (array rows can't go through the normal form submit).
    for (const input of html.querySelectorAll("[data-lp-change]")) {
      input.addEventListener("change", event => this.#onInlineChange(event));
    }
    // Unnamed controls never belong to the document form: keep their change events from
    // triggering submit-on-change (which would fail for players without edit rights).
    for (const input of html.querySelectorAll("input:not([name]), select:not([name]), textarea:not([name])")) {
      input.addEventListener("change", event => event.stopPropagation());
    }
    // Pressing Enter in an "add" field triggers its button instead of submitting the form.
    for (const input of html.querySelectorAll("[data-lp-submit]")) {
      input.addEventListener("keydown", event => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        html.querySelector(`[data-action="${input.dataset.lpSubmit}"]`)?.click();
      });
    }
  }

  /**
   * Players who contribute but don't own the party keep their controls enabled.
   * @override
   */
  _toggleDisabled(disabled) {
    super._toggleDisabled(disabled);
    if (!disabled || !canContribute(this.document)) return;
    for (const el of this.element.querySelectorAll("[data-lp-contrib]")) el.disabled = false;
  }

  /* -------------------------------------------- */
  /*  Drag and drop                               */
  /* -------------------------------------------- */

  /** @override */
  _canDragDrop() {
    return canContribute(this.document);
  }

  /** Member cards and mech panels drag as actors (onto the canvas to place a token, etc.). */
  #bindMemberDrag(html) {
    for (const el of html.querySelectorAll("[data-drag-uuid]")) {
      el.setAttribute("draggable", "true");
      el.addEventListener("dragstart", event => {
        const actor = resolveActor(el.dataset.dragUuid);
        if (!actor) return;
        event.stopPropagation();
        event.dataTransfer.setData("text/plain", JSON.stringify({ ...actor.toDragData(), lancerPartyFrom: this.document.uuid }));
      });
    }
  }

  /**
   * Handle drops explicitly so contributing players (who can't edit the party) can still drop
   * items into the shared reserves.
   * @override
   */
  async _onDrop(event) {
    const data = TextEditor().getDragEventData(event);
    if (!data?.type) return;
    if (Hooks.call("dropActorSheetData", this.document, this, data) === false) return;
    const cls = getDocumentClass(data.type);
    if (!cls?.fromDropData) return;
    const doc = await cls.fromDropData(data);
    if (!doc) return;
    switch (data.type) {
      case "Actor": return this._onDropActor(event, doc);
      case "Item": return this._onDropItem(event, doc);
      case "Folder": return this._onDropFolder(event, doc);
    }
  }

  /** @override */
  async _onDropActor(event, actor) {
    if (!canManage(this.document)) {
      ui.notifications.warn(localize("LANCERPARTY.Error.NotOwner"));
      return null;
    }
    if (actor === this.document) return null;
    const system = this.document.system;
    // Dropping a member on another member card reorders the squad.
    if (system.hasMember(actor)) {
      const targetUuid = event.target.closest?.("[data-member-uuid]")?.dataset.memberUuid;
      const entries = system.memberEntries;
      const toIndex = entries.findIndex(e => e.uuid === targetUuid);
      if (toIndex >= 0 && targetUuid !== actor.uuid) await this.document.update({ "system.members": reorderMember(entries, actor.uuid, toIndex) });
      return actor;
    }
    await actions.addMembersWithFeedback(this.document, [actor]);
    return actor;
  }

  /** @override */
  async _onDropItem(event, item) {
    await guarded(() => actions.stashItem(this.document, item));
    return null;
  }

  /** @override */
  async _onDropFolder(event, folder) {
    if (folder.type === "Actor") {
      const actors = folder.contents.filter(a => a instanceof Actor);
      if (actors.length) await actions.addMembersWithFeedback(this.document, actors);
      return folder;
    }
    if (folder.type === "Item") {
      for (const item of folder.contents) await guarded(() => actions.stashItem(this.document, item));
      return folder;
    }
    return null;
  }

  /** Parties don't take active effects. @override */
  async _onDropActiveEffect() {
    return null;
  }

  /* -------------------------------------------- */
  /*  Handlers                                    */
  /* -------------------------------------------- */

  /** Run an op through the relay with error reporting. */
  #op(op) {
    return guarded(() => requestPartyOp(this.document, op));
  }

  async #onInlineChange(event) {
    const el = event.currentTarget;
    const { lpChange: kind, id } = el.dataset;
    const value = el.type === "checkbox" ? el.checked : el.value;
    switch (kind) {
      case "clockName": return this.#op({ type: "clock.update", id, changes: { name: value } });
      case "clockSegments": return this.#op({ type: "clock.update", id, changes: { segments: Number(value) } });
      case "clockKind": return this.#op({ type: "clock.update", id, changes: { kind: value } });
      case "objectiveText": return this.#op({ type: "objective.update", id, changes: { text: value } });
      case "role": return this.#op({ type: "member.role", uuid: el.dataset.uuid, role: value });
      case "manna": return this.#op({ type: "manna.set", value: Number(value) });
    }
  }

  static #uuidOf(target) {
    return target.closest("[data-member-uuid]")?.dataset.memberUuid ?? target.dataset.uuid;
  }

  static #onOpenMember(event, target) {
    const actor = resolveActor(target.dataset.uuid ?? PartySheet.#uuidOf(target));
    if (actor?.testUserPermission(game.user, "LIMITED")) actor.sheet.render(true);
  }

  static async #onRemoveMember(event, target) {
    const uuid = PartySheet.#uuidOf(target);
    const actor = resolveActor(uuid);
    const ok = await DialogV2.confirm({
      window: { title: localize("LANCERPARTY.Member.RemoveTitle") },
      content: `<p>${format("LANCERPARTY.Member.RemoveBody", { name: escapeHTML(actor?.name ?? uuid), party: escapeHTML(this.document.name) })}</p>`,
      rejectClose: false
    });
    if (ok) await guarded(() => this.document.system.removeMembers(uuid));
  }

  static #onPruneMissing() {
    return guarded(() => this.document.system.pruneMissing());
  }

  static #onSetActive() {
    return guarded(() => actions.setActiveParty(this.document));
  }

  static #onGroupCheck() {
    return guarded(() => requestGroupCheck(this.document));
  }

  static #onFullRepair() {
    return guarded(() => actions.fullRepair(this.document));
  }

  static async #onAwardLicense() {
    const ok = await DialogV2.confirm({
      window: { title: localize("LANCERPARTY.License.Title") },
      content: `<p>${localize("LANCERPARTY.License.Body")}</p>`,
      rejectClose: false
    });
    if (ok) await guarded(() => actions.awardLicenseLevel(this.document, 1));
  }

  static async #onDeploy() {
    await this.minimize();
    try {
      await guarded(() => actions.deployParty(this.document));
    } finally {
      await this.maximize();
    }
  }

  static #onRecall() {
    return guarded(() => actions.recallParty(this.document));
  }

  static #onCombat() {
    return guarded(() => actions.addPartyToCombat(this.document));
  }

  static #onRoster() {
    return guarded(() => actions.postRoster(this.document));
  }

  static #onEndMission() {
    return guarded(() => actions.endMission(this.document));
  }

  static #onClockAdd(event, target) {
    const form = target.closest("[data-lp-new-clock]");
    const name = form?.querySelector("[data-lp-field=name]")?.value ?? "";
    const segments = Number(form?.querySelector("[data-lp-field=segments]")?.value ?? 4);
    const kind = form?.querySelector("[data-lp-field=kind]")?.value ?? "progress";
    return this.#op({ type: "clock.add", name: name || localize("LANCERPARTY.Clock.NewName"), segments, kind });
  }

  static #onClockTick(event, target) {
    const id = target.closest("[data-clock-id]")?.dataset.clockId;
    const delta = event.button === 2 || event.shiftKey ? -1 : 1;
    return this.#op({ type: "clock.tick", id, delta });
  }

  static async #onClockDelete(event, target) {
    const id = target.closest("[data-clock-id]")?.dataset.clockId;
    const ok = await DialogV2.confirm({
      window: { title: localize("LANCERPARTY.Clock.DeleteTitle") },
      content: `<p>${localize("LANCERPARTY.Clock.DeleteBody")}</p>`,
      rejectClose: false
    });
    if (ok) await this.#op({ type: "clock.delete", id });
  }

  static #onClockHide(event, target) {
    const id = target.closest("[data-clock-id]")?.dataset.clockId;
    const clock = this.document.system.clocks.find(c => c.id === id);
    return this.#op({ type: "clock.update", id, changes: { hidden: !clock?.hidden } });
  }

  static #onClockReset() {
    return this.#op({ type: "clock.reset" });
  }

  static #onObjectiveAdd(event, target) {
    const input = target.closest("[data-lp-new-objective]")?.querySelector("input");
    const text = input?.value?.trim();
    if (!text) return;
    return this.#op({ type: "objective.add", text });
  }

  static #onObjectiveToggle(event, target) {
    return this.#op({ type: "objective.toggle", id: target.closest("[data-objective-id]")?.dataset.objectiveId });
  }

  static #onObjectiveDelete(event, target) {
    return this.#op({ type: "objective.delete", id: target.closest("[data-objective-id]")?.dataset.objectiveId });
  }

  static #onObjectiveHide(event, target) {
    const id = target.closest("[data-objective-id]")?.dataset.objectiveId;
    const objective = this.document.system.objectives.find(o => o.id === id);
    return this.#op({ type: "objective.update", id, changes: { hidden: !objective?.hidden } });
  }

  static async #onReserveGive(event, target) {
    const id = target.closest("[data-reserve-id]")?.dataset.reserveId;
    const targets = this.#giveTargets();
    if (!targets.length) {
      ui.notifications.warn(localize("LANCERPARTY.Reserves.NoTargets"));
      return;
    }
    let actorUuid = targets[0].uuid;
    if (targets.length > 1) {
      const options = targets.map(t => `<option value="${t.uuid}">${escapeHTML(t.name)}</option>`).join("");
      const result = await DialogV2.wait({
        window: { title: localize("LANCERPARTY.Reserves.GiveTitle") },
        content: `<div class="form-group"><label>${localize("LANCERPARTY.Reserves.GiveTo")}</label><select name="target">${options}</select></div>`,
        buttons: [
          { action: "give", label: localize("LANCERPARTY.Reserves.Give"), default: true,
            callback: (_e, button) => button.form.elements.target.value },
          { action: "cancel", label: localize("Cancel") }
        ],
        rejectClose: false
      });
      if (!result || result === "cancel") return;
      actorUuid = result;
    }
    const ok = await guarded(() => actions.giveReserve(this.document, id, actorUuid));
    if (ok) ui.notifications.info(format("LANCERPARTY.Reserves.Given", { name: resolveActor(actorUuid)?.name ?? "" }));
  }

  static async #onReserveDelete(event, target) {
    const id = target.closest("[data-reserve-id]")?.dataset.reserveId;
    const ok = await DialogV2.confirm({
      window: { title: localize("LANCERPARTY.Reserves.DeleteTitle") },
      content: `<p>${localize("LANCERPARTY.Reserves.DeleteBody")}</p>`,
      rejectClose: false
    });
    if (ok) await this.#op({ type: "reserve.remove", id });
  }

  static #onReserveAdjust(event, target) {
    const id = target.closest("[data-reserve-id]")?.dataset.reserveId;
    return this.#op({ type: "reserve.adjust", id, delta: Number(target.dataset.delta) || 0 });
  }

  static async #onReservePost(event, target) {
    const id = target.closest("[data-reserve-id]")?.dataset.reserveId;
    const entry = this.document.system.reserves.find(r => r.id === id);
    if (!entry) return;
    await ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor: this.document }),
      content: `<div class="lancer-party-card reserve"><h3><img src="${escapeHTML(entry.img || "icons/svg/item-bag.svg")}" width="24" height="24"> ${escapeHTML(entry.name)}</h3>${entry.description ?? ""}</div>`
    });
  }

  static async #onReserveAddCustom() {
    const result = await DialogV2.wait({
      window: { title: localize("LANCERPARTY.Reserves.AddCustom") },
      content: `<div class="form-group"><label>${localize("LANCERPARTY.Reserves.Name")}</label><input type="text" name="name" autofocus></div>
        <div class="form-group stacked"><label>${localize("LANCERPARTY.Reserves.Description")}</label><textarea name="description" rows="4"></textarea></div>`,
      buttons: [
        { action: "add", label: localize("LANCERPARTY.Reserves.Add"), default: true,
          callback: (_e, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
        { action: "cancel", label: localize("Cancel") }
      ],
      rejectClose: false
    });
    if (!result || result === "cancel" || !result.name?.trim()) return;
    const description = result.description ? `<p>${escapeHTML(result.description).replace(/\n/g, "<br>")}</p>` : "";
    await guarded(() => actions.addCustomReserve(this.document, { name: result.name.trim(), description, itemType: "" }));
  }

  static #onMannaAdjust(event, target) {
    const step = event.shiftKey ? 100 : 10;
    return this.#op({ type: "manna.adjust", delta: Number(target.dataset.direction) * step });
  }

  static #onLogDelete(event, target) {
    return this.#op({ type: "log.delete", id: target.closest("[data-log-id]")?.dataset.logId });
  }
}

/** Re-render open party sheets that show `actor` (debounced per party). */
export const refreshPartySheetsFor = (() => {
  const pending = new Map();
  return (actor, parties) => {
    for (const party of parties) {
      if (!party.sheet?.rendered) continue;
      clearTimeout(pending.get(party.id));
      pending.set(party.id, setTimeout(() => {
        pending.delete(party.id);
        party.sheet?.rendered && party.sheet.render();
      }, 100));
    }
  };
})();

export { MODULE_ID };
