/**
 * @file Group checks: the GM asks the squad for a check; each player rolls from the chat card.
 *
 * The roll itself is Lancer's StatRollFlow (skill trigger, mech skill or grit), so players get
 * Lancer's accuracy/difficulty HUD and the normal Lancer roll card. The group card collects the
 * totals and shows whether the squad succeeded.
 *
 * @module lancer-party/apps/group-check
 */

import { CHECK_MODES, CHECK_TARGET, HASE, LANCER, MODULE_ID, TEMPLATES } from "../constants.js";
import {
  collectSkillOptions, evaluateGroupCheck, normalizeCheck, parseCheckValue, skillKey
} from "../logic/group-check.js";
import { activeMechOf } from "../logic/lancer.js";
import { submitGroupCheckResult } from "../relay.js";
import { log } from "../settings.js";
import { format, guarded, localize, renderTemplate, resolveActor } from "../util.js";

const { DialogV2 } = foundry.applications.api;

/** Localized HASE labels. */
const haseLabel = key => localize(`LANCERPARTY.HASE.${key}`);

/** Skill trigger items on a pilot. */
const skillsOf = actor => (actor?.items?.filter(i => i.type === "skill") ?? []);

/**
 * Build the select options for the request dialog from the party's pilots.
 * @param {Actor} party
 */
export function checkOptions(party) {
  const pilots = party.system.pilots;
  const skills = collectSkillOptions(pilots.map(skillsOf));
  return {
    skills: skills.map(s => ({ value: `skill:${s.key}`, label: `${s.label} (${s.count}/${pilots.length})` })),
    hase: HASE.map(k => ({ value: `hase:${k}`, label: haseLabel(k) })),
    other: [
      { value: "grit", label: localize("LANCERPARTY.Check.Grit") },
      { value: "flat", label: localize("LANCERPARTY.Check.Flat") }
    ]
  };
}

/** Label for a parsed check value, using the first pilot that has the skill for its name. */
function labelFor(party, parsed) {
  if (parsed.kind === "hase") return haseLabel(parsed.key);
  if (parsed.kind === "grit") return localize("LANCERPARTY.Check.Grit");
  if (parsed.kind === "flat") return localize("LANCERPARTY.Check.Flat");
  for (const pilot of party.system.pilots) {
    const item = skillsOf(pilot).find(i => skillKey(i) === parsed.key);
    if (item) return item.name;
  }
  return parsed.key;
}

/**
 * Open the request dialog and post a group check card.
 * @param {Actor} party
 * @param {{check?: string, mode?: string, members?: string[], title?: string, prompt?: boolean}} [preset]
 * @returns {Promise<ChatMessage|null>}
 */
export async function requestGroupCheck(party, preset = {}) {
  const members = party.system.memberActors;
  if (!members.length) {
    ui.notifications.warn(localize("LANCERPARTY.Error.NoMembers"));
    return null;
  }
  let data = { check: preset.check, mode: preset.mode ?? "each", title: preset.title ?? "", members: preset.members };
  if (preset.prompt !== false) {
    const content = await renderTemplate(`${TEMPLATES}/dialogs/group-check.hbs`, {
      options: checkOptions(party),
      modes: CHECK_MODES.map(m => ({ value: m, label: localize(`LANCERPARTY.Check.Mode.${m}`) })),
      members: members.map(a => ({ uuid: a.uuid, name: a.name, img: a.img })),
      selected: preset.check ?? "hase:hull"
    });
    const result = await DialogV2.wait({
      window: { title: localize("LANCERPARTY.Check.RequestTitle"), icon: "fa-solid fa-dice-d20" },
      position: { width: 440 },
      content,
      buttons: [
        { action: "request", label: localize("LANCERPARTY.Check.Request"), icon: "fa-solid fa-paper-plane", default: true,
          callback: (_e, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
        { action: "cancel", label: localize("Cancel"), icon: "fa-solid fa-xmark" }
      ],
      rejectClose: false
    });
    if (!result || result === "cancel") return null;
    const picked = members.filter((_a, index) => result[`member-${index}`]).map(a => a.uuid);
    data = { check: result.check, mode: result.mode, title: result.title, members: picked };
  }

  const parsed = parseCheckValue(data.check);
  if (!parsed) {
    ui.notifications.error(localize("LANCERPARTY.Error.Generic"));
    return null;
  }
  const check = normalizeCheck({ ...parsed, label: labelFor(party, parsed) });
  const chosen = data.members?.length ? members.filter(a => data.members.includes(a.uuid)) : members;
  if (!chosen.length) {
    ui.notifications.warn(localize("LANCERPARTY.Error.NoMembers"));
    return null;
  }
  const flag = {
    partyUuid: party.uuid,
    title: String(data.title ?? "").slice(0, 120),
    check,
    mode: CHECK_MODES.includes(data.mode) ? data.mode : "each",
    target: CHECK_TARGET,
    rows: chosen.map(a => ({ uuid: a.uuid, name: a.name, img: a.img, total: null, rollerUuid: null }))
  };
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor: party }),
    content: await renderGroupCheckContent(flag),
    flags: { [MODULE_ID]: { groupCheck: flag } }
  });
}

/**
 * Render the card HTML from the stored flag.
 * @param {object} flag
 * @returns {Promise<string>}
 */
export async function renderGroupCheckContent(flag) {
  const summary = evaluateGroupCheck(flag.rows, flag.mode, flag.target);
  const rows = flag.rows.map(r => ({
    ...r,
    rolled: Number.isFinite(r.total),
    success: Number.isFinite(r.total) && r.total >= flag.target
  }));
  return renderTemplate(`${TEMPLATES}/chat/group-check.hbs`, {
    flag,
    rows,
    summary,
    modeLabel: localize(`LANCERPARTY.Check.Mode.${flag.mode}`),
    outcomeLabel: summary.outcome ? localize(`LANCERPARTY.Check.Outcome.${summary.outcome}`) : null
  });
}

/* -------------------------------------------- */
/*  Rolling                                     */
/* -------------------------------------------- */

/**
 * Determine who rolls and how for a member.
 * @param {Actor} member
 * @param {object} check  Normalised check descriptor.
 * @returns {{roller: Actor|Item, title: string, path?: string, bonus: number}}
 */
export function rollPlanFor(member, check) {
  const title = check.label;
  if (check.kind === "skill") {
    if (member.type === LANCER.PILOT) {
      const item = skillsOf(member).find(i => skillKey(i) === check.key);
      if (item) return { roller: item, actor: member, title, bonus: (Number(item.system?.curr_rank) || 0) * 2 };
    }
    // No matching trigger: Lancer rolls a plain d20.
    return { roller: member, actor: member, title, path: "system.__lancerPartyNoSkill", bonus: 0 };
  }
  if (check.kind === "hase") {
    const actor = member.type === LANCER.PILOT ? (activeMechOf(member) ?? member) : member;
    return { roller: actor, actor, title, path: `system.${check.key}`, bonus: Number(actor.system?.[check.key]) || 0 };
  }
  if (check.kind === "grit") {
    return { roller: member, actor: member, title, path: "system.grit", bonus: Number(member.system?.grit) || 0 };
  }
  return { roller: member, actor: member, title, path: "system.__lancerPartyFlat", bonus: 0 };
}

/**
 * Roll through Lancer's StatRollFlow, falling back to a plain roll if the flow API is missing.
 * @returns {Promise<number|null>}  Total, or null if the roll was cancelled.
 */
async function performRoll(plan) {
  const StatRollFlow = game.lancer?.flows?.get?.("StatRollFlow");
  if (StatRollFlow) {
    const data = { title: plan.title };
    if (plan.path) data.path = plan.path;
    const flow = new StatRollFlow(plan.roller, data);
    const ok = await flow.begin();
    if (!ok) return null;
    const total = flow.state?.data?.result?.roll?.total;
    return Number.isFinite(total) ? total : null;
  }
  log.warn("Lancer StatRollFlow not found; using a plain roll");
  const roll = await new Roll(`1d20 + ${plan.bonus}`).evaluate();
  await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor: plan.actor }), flavor: plan.title });
  return roll.total;
}

/**
 * Roll for one row of a group check card.
 * @param {ChatMessage} message
 * @param {string} uuid  Member UUID.
 * @param {{reroll?: boolean}} [options]
 */
export async function rollForMember(message, uuid, { reroll = false } = {}) {
  const flag = message.getFlag(MODULE_ID, "groupCheck");
  const row = flag?.rows.find(r => r.uuid === uuid);
  const member = resolveActor(uuid);
  if (!row || !member) {
    ui.notifications.warn(localize("LANCERPARTY.Error.MemberMissing"));
    return;
  }
  if (Number.isFinite(row.total) && !(reroll && game.user.isGM)) return;
  const check = normalizeCheck(flag.check);
  if (!check) return;
  const plan = rollPlanFor(member, check);
  if (!plan.actor.isOwner) {
    ui.notifications.warn(format("LANCERPARTY.Error.CannotRollFor", { name: member.name }));
    return;
  }
  const total = await performRoll(plan);
  if (total === null) return;
  const ok = await submitGroupCheckResult(message, { uuid, total, rollerUuid: plan.actor.uuid, reroll });
  if (!ok) ui.notifications.warn(localize("LANCERPARTY.Error.ResultNotSaved"));
}

/**
 * `renderChatMessageHTML` handler: show roll buttons to those who may use them.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function onRenderChatMessage(message, html) {
  const flag = message.getFlag(MODULE_ID, "groupCheck");
  if (!flag) return;
  for (const li of html.querySelectorAll(".lp-check-row[data-uuid]")) {
    const actor = resolveActor(li.dataset.uuid);
    const button = li.querySelector("[data-lp-roll]");
    const reroll = li.querySelector("[data-lp-reroll]");
    const canRoll = !!actor && (actor.isOwner || (actor.type === LANCER.PILOT && activeMechOf(actor)?.isOwner));
    if (button) {
      if (!canRoll) button.remove();
      else button.addEventListener("click", event => {
        event.preventDefault();
        guarded(() => rollForMember(message, li.dataset.uuid));
      });
    }
    if (reroll) {
      if (!game.user.isGM) reroll.remove();
      else reroll.addEventListener("click", event => {
        event.preventDefault();
        guarded(() => rollForMember(message, li.dataset.uuid, { reroll: true }));
      });
    }
    // Clicking a portrait opens the sheet if permitted.
    li.querySelector("img")?.addEventListener("click", () => actor?.testUserPermission(game.user, "LIMITED") && actor.sheet.render(true));
  }
}
