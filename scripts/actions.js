/**
 * @file Party-wide actions: repairs, License Level awards, deployment, combat, reserves, missions.
 *
 * Lancer integration notes:
 *  - Full Repair runs Lancer's own "executeFullRepair" flow step for each actor, so the result is
 *    identical to pressing Full Repair on each sheet (statuses cleared, unequipped items removed,
 *    pilot repair also repairs the active mech, Lancer chat card posted). Lancer's per-actor
 *    confirmation dialog is replaced by one party-level confirmation.
 *  - License Level awards only bump `system.level`; the player then spends it on their sheet.
 *
 * @module lancer-party/actions
 */

import { LANCER, MAX_LICENSE_LEVEL, MODULE_ID, PARTY_TYPE, QUERY_NAME, TEMPLATES } from "./constants.js";
import { cellKey, occupy, planFormation } from "./logic/formation.js";
import { activeMechOf, deployableActorFor, memberSnapshot, tokenSize } from "./logic/lancer.js";
import { planLicenseAward } from "./logic/ops.js";
import { canContribute, canManage, executePartyOp, requestPartyOp } from "./relay.js";
import { SETTINGS, defaultOwnershipLevel, getSetting, log } from "./settings.js";
import {
  activeGM, escapeHTML, format, getActiveParty, getParties, isParty, localize, renderTemplate, resolveActor,
  statusInfo, today
} from "./util.js";

const { DialogV2 } = foundry.applications.api;

/* -------------------------------------------- */
/*  Party lifecycle                             */
/* -------------------------------------------- */

/**
 * Create a party. Opens Foundry's create dialog restricted to the party type unless `data.name` is given.
 * @param {object} [data]
 * @param {{renderSheet?: boolean, dialog?: boolean}} [options]
 * @returns {Promise<Actor|null>}
 */
export async function createParty(data = {}, { renderSheet = true, dialog = true } = {}) {
  const ActorCls = getDocumentClass("Actor");
  if (dialog && !data.name) {
    return ActorCls.createDialog({ type: PARTY_TYPE, ...data }, {}, { types: [PARTY_TYPE] });
  }
  return ActorCls.create({ name: localize("LANCERPARTY.DefaultName"), type: PARTY_TYPE, ...data }, { renderSheet });
}

/** Set the world's active party (GM). */
export async function setActiveParty(party) {
  if (!game.user.isGM || !isParty(party)) return;
  await game.settings.set(MODULE_ID, SETTINGS.ACTIVE_PARTY, party.id);
}

/** Create the first party in a world that has none (active GM, once). */
export async function createFirstParty() {
  if (!game.user.isActiveGM || !getSetting(SETTINGS.AUTO_CREATE) || getSetting(SETTINGS.CREATED_FIRST)) return;
  try {
    if (!getParties().length) {
      const party = await getDocumentClass("Actor").create({
        name: localize("LANCERPARTY.DefaultName"),
        type: PARTY_TYPE,
        ownership: { default: defaultOwnershipLevel() }
      });
      if (party) await setActiveParty(party);
    }
    await game.settings.set(MODULE_ID, SETTINGS.CREATED_FIRST, true);
  } catch (err) {
    log.error("Could not create the first party", err);
  }
}

/**
 * Add actors (or a dropped folder of actors) to a party with user feedback.
 * @param {Actor} party
 * @param {Actor[]} actors
 */
export async function addMembersWithFeedback(party, actors) {
  if (!canManage(party)) {
    ui.notifications.warn(localize("LANCERPARTY.Error.NotOwner"));
    return null;
  }
  const plan = await party.system.addMembers(...actors);
  for (const { from, to } of plan.redirected) {
    const mech = resolveActor(from);
    const pilot = resolveActor(to);
    if (mech && pilot) ui.notifications.info(format("LANCERPARTY.Notify.MechRedirected", { mech: mech.name, pilot: pilot.name }));
  }
  const refused = plan.skipped.filter(s => s.reason !== "duplicate");
  if (refused.length) ui.notifications.warn(format("LANCERPARTY.Notify.NotAdded", { count: refused.length }));
  return plan;
}

/* -------------------------------------------- */
/*  Repairs and License Levels                  */
/* -------------------------------------------- */

/** Actors that a party full repair touches, without duplicates (pilot repair includes its mech). */
function repairTargets(party) {
  const targets = [];
  const covered = new Set();
  for (const actor of party.system.memberActors) {
    if (actor.type === LANCER.PILOT) {
      targets.push(actor);
      const mech = activeMechOf(actor);
      if (mech) covered.add(mech.id);
    }
  }
  for (const actor of party.system.memberActors) {
    if (actor.type !== LANCER.PILOT && !covered.has(actor.id)) targets.push(actor);
  }
  return targets;
}

/**
 * Run a Lancer Full Repair for every member.
 * @param {Actor} party
 * @param {{confirm?: boolean}} [options]
 * @returns {Promise<string[]>}  Names of repaired actors.
 */
export async function fullRepair(party, { confirm = true } = {}) {
  const targets = repairTargets(party).filter(a => a.isOwner);
  if (!targets.length) {
    ui.notifications.warn(localize("LANCERPARTY.Error.NothingToRepair"));
    return [];
  }
  if (confirm) {
    const list = targets.map(a => {
      const mech = activeMechOf(a);
      return `<li>${escapeHTML(a.name)}${mech ? ` + ${escapeHTML(mech.name)}` : ""}</li>`;
    }).join("");
    const ok = await DialogV2.confirm({
      window: { title: localize("LANCERPARTY.FullRepair.Title"), icon: "fa-solid fa-screwdriver-wrench" },
      content: `<p>${localize("LANCERPARTY.FullRepair.Body")}</p><ul>${list}</ul><p class="hint">${localize("LANCERPARTY.FullRepair.Warning")}</p>`,
      rejectClose: false
    });
    if (!ok) return [];
  }
  const repaired = [];
  for (const actor of targets) {
    try {
      await lancerFullRepair(actor);
      repaired.push(actor.name);
    } catch (err) {
      log.error(`Full repair failed for ${actor.name}`, err);
      ui.notifications.error(format("LANCERPARTY.Error.RepairFailed", { name: actor.name }));
    }
  }
  return repaired;
}

/** One actor's full repair through Lancer's flow step, with a fallback to the loadout helper. */
async function lancerFullRepair(actor) {
  const Flow = game.lancer?.flows?.get?.("FullRepairFlow");
  const step = game.lancer?.flowSteps?.get?.("executeFullRepair");
  if (Flow && typeof step === "function") {
    const flow = new Flow(actor);
    return step(flow.state);
  }
  if (actor.loadoutHelper?.fullRepair) return actor.loadoutHelper.fullRepair();
  throw new Error("Lancer full repair API not available");
}

/**
 * Raise every member pilot's License Level.
 * @param {Actor} party
 * @param {number} [amount=1]
 * @param {{chat?: boolean}} [options]
 */
export async function awardLicenseLevel(party, amount = 1, { chat = true } = {}) {
  const pilots = party.system.pilots;
  const plan = planLicenseAward(pilots.map(p => ({ uuid: p.uuid, level: p.system.level })), amount);
  const applied = [];
  for (const step of plan) {
    const pilot = resolveActor(step.uuid);
    if (!pilot?.isOwner) continue;
    await pilot.update({ "system.level": step.to });
    applied.push({ name: pilot.name, ...step });
  }
  if (chat && applied.length) {
    const rows = applied.map(a => `<li><strong>${escapeHTML(a.name)}</strong>: LL ${a.from} → LL ${a.to}</li>`).join("");
    await ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor: party }),
      content: `<div class="lancer-party-card"><h3>${localize("LANCERPARTY.License.ChatTitle")}</h3><ul>${rows}</ul><p class="hint">${format("LANCERPARTY.License.Cap", { max: MAX_LICENSE_LEVEL })}</p></div>`
    });
  }
  if (!plan.length) ui.notifications.info(localize("LANCERPARTY.License.NoneChanged"));
  return applied;
}

/* -------------------------------------------- */
/*  Scene: deploy, recall, combat               */
/* -------------------------------------------- */

/** Actors that represent the party on a map for a given mode, without duplicates. */
function actorsToDeploy(party, mode) {
  const actors = party.system.memberActors.map(a => deployableActorFor(a, mode)).filter(Boolean);
  return [...new Set(actors)];
}

/** Tokens on the scene for any party member, member mech, or the party itself. */
function partyTokensOnScene(party, scene) {
  const ids = new Set([party.id, ...party.system.memberActors.map(a => a.id), ...party.system.mechActors.map(a => a.id)]);
  return scene.tokens.filter(t => ids.has(t.actorId));
}

/**
 * Ask which actors to deploy, then place tokens around the party token (or the view centre).
 * @param {Actor} party
 * @param {{mode?: "auto"|"mech"|"pilot", replacePartyToken?: boolean, prompt?: boolean}} [options]
 */
export async function deployParty(party, { mode, replacePartyToken, prompt = true } = {}) {
  const scene = canvas?.scene;
  if (!game.user.isGM || !scene || !canvas.ready) {
    ui.notifications.warn(localize(game.user.isGM ? "LANCERPARTY.Error.NoScene" : "LANCERPARTY.Error.GMOnly"));
    return [];
  }
  const partyToken = scene.tokens.find(t => t.actorId === party.id);
  if (prompt) {
    const content = await renderTemplate(`${TEMPLATES}/dialogs/deploy.hbs`, { hasPartyToken: !!partyToken });
    const result = await DialogV2.wait({
      window: { title: localize("LANCERPARTY.Deploy.Title"), icon: "fa-solid fa-parachute-box" },
      content,
      buttons: [
        { action: "deploy", label: localize("LANCERPARTY.Deploy.Confirm"), icon: "fa-solid fa-check", default: true,
          callback: (_event, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
        { action: "cancel", label: localize("Cancel"), icon: "fa-solid fa-xmark" }
      ],
      rejectClose: false
    });
    if (!result || result === "cancel") return [];
    mode = result.mode;
    replacePartyToken = !!result.replacePartyToken;
  }
  mode ??= "auto";

  const present = new Set(scene.tokens.map(t => t.actorId));
  const actors = actorsToDeploy(party, mode).filter(a => !present.has(a.id));
  if (!actors.length) {
    ui.notifications.info(localize("LANCERPARTY.Deploy.NothingToDeploy"));
    return [];
  }

  const grid = canvas.grid;
  const anchorPoint = partyToken
    ? { x: partyToken.x + (partyToken.width * grid.sizeX) / 2, y: partyToken.y + (partyToken.height * grid.sizeY) / 2 }
    : { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y };
  const anchor = grid.getOffset(anchorPoint);

  const occupied = new Set();
  for (const token of scene.tokens) {
    if (replacePartyToken && token === partyToken) continue;
    if (token.hidden) continue;
    occupy(occupied, grid.getOffset({ x: token.x, y: token.y }), Math.max(token.width, token.height));
  }
  const dims = canvas.dimensions;
  const offsetOf = (x, y) => grid.getOffset({ x, y });
  const minCell = offsetOf(dims.sceneX, dims.sceneY);
  const maxCell = offsetOf(dims.sceneX + dims.sceneWidth - 1, dims.sceneY + dims.sceneHeight - 1);
  // Shift into a zero-based frame so the planner can enforce scene bounds.
  const rel = c => ({ i: c.i - minCell.i, j: c.j - minCell.j });
  const relOccupied = [...occupied].map(k => {
    const [i, j] = k.split(",").map(Number);
    return cellKey(i - minCell.i, j - minCell.j);
  });
  const placements = planFormation({
    anchor: rel(anchor),
    sizes: actors.map(tokenSize),
    occupied: relOccupied,
    bounds: { rows: maxCell.i - minCell.i + 1, cols: maxCell.j - minCell.j + 1 }
  });

  const tokenData = [];
  for (const [index, actor] of actors.entries()) {
    const cell = placements[index];
    if (!cell) continue;
    const point = grid.getTopLeftPoint({ i: cell.i + minCell.i, j: cell.j + minCell.j });
    const doc = await actor.getTokenDocument({ x: point.x, y: point.y });
    tokenData.push(doc.toObject());
  }
  const created = tokenData.length ? await scene.createEmbeddedDocuments("Token", tokenData) : [];
  if (replacePartyToken && partyToken && created.length) await partyToken.delete();
  if (created.length < actors.length) ui.notifications.warn(localize("LANCERPARTY.Deploy.NoRoom"));
  return created;
}

/**
 * Remove member and mech tokens from the current scene; optionally leave the party token where they were.
 * @param {Actor} party
 */
export async function recallParty(party) {
  const scene = canvas?.scene;
  if (!game.user.isGM || !scene) {
    ui.notifications.warn(localize(game.user.isGM ? "LANCERPARTY.Error.NoScene" : "LANCERPARTY.Error.GMOnly"));
    return;
  }
  const tokens = partyTokensOnScene(party, scene).filter(t => t.actorId !== party.id);
  if (!tokens.length) {
    ui.notifications.info(localize("LANCERPARTY.Recall.Nothing"));
    return;
  }
  const result = await DialogV2.wait({
    window: { title: localize("LANCERPARTY.Recall.Title"), icon: "fa-solid fa-person-walking-arrow-loop-left" },
    content: `<p>${format("LANCERPARTY.Recall.Body", { count: tokens.length })}</p>
      <div class="form-group"><label class="checkbox"><input type="checkbox" name="placeParty" checked> ${localize("LANCERPARTY.Recall.PlaceParty")}</label></div>`,
    buttons: [
      { action: "recall", label: localize("LANCERPARTY.Recall.Confirm"), icon: "fa-solid fa-check", default: true,
        callback: (_e, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
      { action: "cancel", label: localize("Cancel"), icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if (!result || result === "cancel") return;

  const cx = tokens.reduce((s, t) => s + t.x, 0) / tokens.length;
  const cy = tokens.reduce((s, t) => s + t.y, 0) / tokens.length;
  await scene.deleteEmbeddedDocuments("Token", tokens.map(t => t.id));
  if (result.placeParty) {
    const snapped = canvas.grid.getTopLeftPoint(canvas.grid.getOffset({ x: cx, y: cy }));
    const existing = scene.tokens.find(t => t.actorId === party.id);
    if (existing) await existing.update({ x: snapped.x, y: snapped.y });
    else {
      const doc = await party.getTokenDocument({ x: snapped.x, y: snapped.y });
      await scene.createEmbeddedDocuments("Token", [doc.toObject()]);
    }
  }
}

/**
 * Add the party's tokens on the current scene to the combat encounter (creating one if needed).
 * The party's own token is never added.
 * @param {Actor} party
 */
export async function addPartyToCombat(party) {
  const scene = canvas?.scene;
  if (!scene) {
    ui.notifications.warn(localize("LANCERPARTY.Error.NoScene"));
    return [];
  }
  const tokens = partyTokensOnScene(party, scene).filter(t => t.actorId !== party.id && !t.inCombat && t.isOwner);
  if (!tokens.length) {
    ui.notifications.info(localize("LANCERPARTY.Combat.NoTokens"));
    return [];
  }
  let combat = game.combats.viewed?.scene === scene || !game.combats.viewed?.scene ? game.combats.viewed : null;
  if (!combat) {
    if (!game.user.isGM) {
      ui.notifications.warn(localize("LANCERPARTY.Combat.NoEncounter"));
      return [];
    }
    combat = await getDocumentClass("Combat").create({ scene: scene.id, active: true });
  }
  return getDocumentClass("Token").createCombatants(tokens, { combat });
}

/* -------------------------------------------- */
/*  Chat                                        */
/* -------------------------------------------- */

/** Post a roster with mech status to chat. */
export async function postRoster(party) {
  const members = party.system.memberActors.map(a => memberSnapshot(a, { statusInfo }));
  const content = await renderTemplate(`${TEMPLATES}/chat/roster.hbs`, { party, members });
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor: party }),
    content
  });
}

/* -------------------------------------------- */
/*  Reserves                                    */
/* -------------------------------------------- */

/** Data stored for a reserve entry from an Item document. */
export function reserveEntryFromItem(item) {
  const itemData = item.toObject();
  delete itemData._id;
  delete itemData.folder;
  delete itemData.sort;
  delete itemData.ownership;
  delete itemData._stats;
  const description = item.system?.description ?? item.system?.effect ?? "";
  return {
    name: item.name,
    img: item.img ?? "",
    itemType: item.type,
    description: typeof description === "string" ? description : "",
    quantity: 1,
    itemData
  };
}

/**
 * Store a dropped item in the party's reserves. Items dragged out of an actor the user owns are
 * moved (removed from that actor); world/compendium items are copied.
 * @param {Actor} party
 * @param {Item} item
 */
export async function stashItem(party, item) {
  if (!canContribute(party)) {
    ui.notifications.warn(localize("LANCERPARTY.Error.NotOwner"));
    return null;
  }
  const id = await requestPartyOp(party, { type: "reserve.add", entry: reserveEntryFromItem(item) });
  if (id && item.parent instanceof Actor && item.parent.isOwner && item.parent !== party) await item.delete();
  return id;
}

/** Add a hand-written reserve (no item behind it). */
export function addCustomReserve(party, entry) {
  return requestPartyOp(party, { type: "reserve.add", entry: { quantity: 1, ...entry, itemData: null } });
}

/**
 * Give a reserve to an actor: create the stored item on it and decrement/remove the entry.
 * Runs locally when the user owns both party and target, otherwise through the GM.
 * @param {Actor} party
 * @param {string} entryId
 * @param {string} actorUuid
 * @param {User} [user=game.user]  When called by the relay: the requesting user.
 * @returns {Promise<boolean>}
 */
export async function giveReserve(party, entryId, actorUuid, user = game.user) {
  const target = resolveActor(actorUuid);
  const entry = party.system.reserves.find(r => r.id === entryId);
  if (!target || !entry) return false;
  const userCanTarget = target.testUserPermission(user, "OWNER");
  const userCanParty = canManage(party, user) || canContribute(party, user);
  if (!userCanTarget || !userCanParty) {
    if (user === game.user) ui.notifications.warn(localize("LANCERPARTY.Error.NotOwner"));
    return false;
  }
  // If this client can't write both documents, hand the whole operation to the GM.
  if (!target.isOwner || !party.isOwner) {
    const gm = activeGM();
    if (!gm || user !== game.user) {
      if (!gm) ui.notifications.warn(localize("LANCERPARTY.Error.NoGM"));
      return false;
    }
    const response = await gm.query(QUERY_NAME, { action: "giveReserve", partyUuid: party.uuid, entryId, actorUuid, userId: game.user.id });
    return !!response?.ok;
  }
  if (entry.itemData) {
    const data = foundry.utils.deepClone(entry.itemData);
    await target.createEmbeddedDocuments("Item", [data]);
  } else {
    // Hand-written reserves become a Lancer "reserve" item when the target can hold one.
    const types = game.documentTypes?.Item ?? [];
    if (!types.includes("reserve")) return false;
    await target.createEmbeddedDocuments("Item", [{ name: entry.name, type: "reserve", img: entry.img || undefined, system: { description: entry.description } }]);
  }
  await executePartyOp(party, { type: "reserve.adjust", id: entryId, delta: -1 }, user);
  return true;
}

/* -------------------------------------------- */
/*  Missions                                    */
/* -------------------------------------------- */

/**
 * The end-of-mission workflow: log, repair, award LL, reset clocks/objectives, advance mission number.
 * @param {Actor} party
 */
export async function endMission(party) {
  if (!canManage(party)) {
    ui.notifications.warn(localize("LANCERPARTY.Error.NotOwner"));
    return;
  }
  const mission = party.system.mission;
  const content = await renderTemplate(`${TEMPLATES}/dialogs/end-mission.hbs`, {
    mission,
    pilots: party.system.pilots.length,
    outcomes: ["success", "partial", "failure"].map(value => ({ value, label: localize(`LANCERPARTY.Outcome.${value}`) }))
  });
  const choice = await DialogV2.wait({
    window: { title: localize("LANCERPARTY.EndMission.Title"), icon: "fa-solid fa-flag-checkered" },
    position: { width: 460 },
    content,
    buttons: [
      { action: "end", label: localize("LANCERPARTY.EndMission.Confirm"), icon: "fa-solid fa-check", default: true,
        callback: (_e, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
      { action: "cancel", label: localize("Cancel"), icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if (!choice || choice === "cancel") return;

  const outcome = choice.outcome ?? "success";
  if (choice.log) {
    await executePartyOp(party, {
      type: "log.add",
      entry: { number: mission.number, name: mission.name, sitrep: mission.sitrep, outcome, date: today(), notes: choice.notes ?? "" }
    }, game.user);
  }
  if (choice.repair) await fullRepair(party, { confirm: false });
  if (choice.license) await awardLicenseLevel(party, 1, { chat: false });
  if (choice.resetClocks) await executePartyOp(party, { type: "clock.reset" }, game.user);
  if (choice.clearObjectives) await executePartyOp(party, { type: "objective.clear", onlyDone: false }, game.user);

  const updates = { "system.mission.status": outcome === "failure" ? "failed" : "complete" };
  if (choice.advance) Object.assign(updates, {
    "system.mission.number": (mission.number ?? 0) + 1,
    "system.mission.name": "",
    "system.mission.sitrep": "",
    "system.mission.status": "planning",
    "system.mission.briefing": ""
  });
  await party.update(updates);

  if (choice.chat) {
    const lines = [];
    if (choice.repair) lines.push(localize("LANCERPARTY.EndMission.ChatRepaired"));
    if (choice.license) lines.push(localize("LANCERPARTY.EndMission.ChatLicense"));
    await ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor: party }),
      content: `<div class="lancer-party-card mission-end outcome-${outcome}">
        <h3>${format("LANCERPARTY.EndMission.ChatTitle", { number: mission.number, name: escapeHTML(mission.name || localize("LANCERPARTY.Mission.Untitled")) })}</h3>
        <p class="outcome">${localize(`LANCERPARTY.Outcome.${outcome}`)}</p>
        ${lines.length ? `<ul>${lines.map(l => `<li>${l}</li>`).join("")}</ul>` : ""}
      </div>`
    });
  }
}

export { getActiveParty };
