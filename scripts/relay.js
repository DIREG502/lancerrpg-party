/**
 * @file Permission checks and the GM relay.
 *
 * Parties are usually owned by the GM. Players who own a member actor may still tick clocks,
 * check objectives and manage shared reserves: their client sends the operation to the active
 * GM through Foundry v13's `User#query` (CONFIG.queries), the GM re-checks permissions and
 * applies it. Operations are applied to the party's *current* data in a per-party queue, so
 * simultaneous requests from several players don't overwrite each other.
 *
 * Limitation: Foundry doesn't tell a query handler who sent it, so the requester id travels in
 * the payload. The GM validates that this user owns a member and restricts players to a fixed
 * list of operations (see MEMBER_OPS); it is a table-trust boundary, not a security boundary.
 *
 * @module lancer-party/relay
 */

import { MODULE_ID, QUERY_NAME } from "./constants.js";
import { applyOp, MEMBER_OPS, PartyOpError } from "./logic/ops.js";
import { recordResult } from "./logic/group-check.js";
import { SETTINGS, getSetting, log } from "./settings.js";
import { activeGM, isParty, localize, resolveActor, today } from "./util.js";

/* -------------------------------------------- */
/*  Permissions                                 */
/* -------------------------------------------- */

/**
 * Does the user own at least one member of the party (or a member's mech)?
 * @param {Actor} party
 * @param {User} user
 */
export function ownsAnyMember(party, user = game.user) {
  const actors = [...(party.system.memberActors ?? []), ...(party.system.mechActors ?? [])];
  return actors.some(a => a.testUserPermission(user, "OWNER"));
}

/** May the user change the party directly (document ownership)? */
export const canManage = (party, user = game.user) => !!party?.testUserPermission(user, "OWNER");

/** May the user request member-level operations (clocks, objectives, reserves)? */
export function canContribute(party, user = game.user) {
  if (canManage(party, user)) return true;
  return !!getSetting(SETTINGS.MEMBER_EDITING) && ownsAnyMember(party, user);
}

/* -------------------------------------------- */
/*  Serialised execution                        */
/* -------------------------------------------- */

const queues = new Map();

/**
 * Run tasks for the same key one after another on this client.
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
export function enqueue(key, task) {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  queues.set(key, next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  }));
  return next;
}

/**
 * Apply an operation as `user` on this client. The caller must be allowed to update the party
 * document (owner/GM).
 * @param {Actor} party
 * @param {object} op
 * @param {User} user  The user on whose behalf the op runs.
 */
export function executePartyOp(party, op, user) {
  return enqueue(party.uuid, async () => {
    const isOwner = canManage(party, user);
    if (!isOwner) {
      if (!getSetting(SETTINGS.MEMBER_EDITING) || !ownsAnyMember(party, user)) throw new PartyOpError("denied");
      if (!MEMBER_OPS.has(op?.type)) throw new PartyOpError("denied");
    }
    const ownsMember = uuid => !!resolveActor(uuid)?.testUserPermission(user, "OWNER");
    const { changes, result } = applyOp(party.system.toObject(), op, {
      isOwner,
      ownsMember,
      randomID: () => foundry.utils.randomID(),
      today: today()
    });
    await party.update(changes, { lancerParty: { op: op.type, userId: user.id } });
    return result;
  });
}

/**
 * Request an operation on a party from the current client. Uses the direct path for owners and
 * the GM relay for contributing members.
 * @param {Actor} party
 * @param {object} op
 * @returns {Promise<unknown>}  The op result (e.g. new clock id), or undefined if refused.
 */
export async function requestPartyOp(party, op) {
  if (!isParty(party)) throw new PartyOpError("invalid");
  if (canManage(party)) return executePartyOp(party, op, game.user);
  if (!canContribute(party)) throw new PartyOpError("denied");
  const gm = activeGM();
  if (!gm) {
    ui.notifications.warn(localize("LANCERPARTY.Error.NoGM"));
    return undefined;
  }
  const response = await gm.query(QUERY_NAME, { action: "partyOp", partyUuid: party.uuid, userId: game.user.id, op });
  if (!response?.ok) throw new PartyOpError(response?.code ?? "denied");
  return response.result;
}

/* -------------------------------------------- */
/*  Query handler (runs on the GM)              */
/* -------------------------------------------- */

/** Registered as CONFIG.queries[QUERY_NAME]. */
export async function handleQuery(data) {
  try {
    if (!game.user.isGM) return { ok: false, code: "denied" };
    const user = game.users.get(data?.userId);
    if (!user) return { ok: false, code: "denied" };
    switch (data.action) {
      case "partyOp": {
        const party = await fromUuid(data.partyUuid);
        if (!isParty(party)) return { ok: false, code: "notFound" };
        const result = await executePartyOp(party, data.op, user);
        return { ok: true, result };
      }
      case "groupCheckResult": {
        const ok = await applyGroupCheckResult(data, user);
        return { ok };
      }
      case "giveReserve": {
        const { giveReserve } = await import("./actions.js");
        const party = await fromUuid(data.partyUuid);
        if (!isParty(party)) return { ok: false, code: "notFound" };
        const created = await giveReserve(party, data.entryId, data.actorUuid, user);
        return { ok: !!created };
      }
    }
    return { ok: false, code: "invalid" };
  } catch (err) {
    if (!(err instanceof PartyOpError)) log.error("Relay request failed", err);
    return { ok: false, code: err?.code ?? "invalid" };
  }
}

/* -------------------------------------------- */
/*  Group check results                         */
/* -------------------------------------------- */

/**
 * Store a member's roll on a group check chat card. Runs on whoever may update the message
 * (author or GM), serialised per message.
 * @param {{messageId: string, uuid: string, total: number, rollerUuid?: string}} data
 * @param {User} user  The roller.
 * @returns {Promise<boolean>}
 */
export function applyGroupCheckResult(data, user) {
  return enqueue(`msg.${data.messageId}`, async () => {
    const message = game.messages.get(data.messageId);
    const flag = message?.getFlag(MODULE_ID, "groupCheck");
    if (!flag) return false;
    const actor = resolveActor(data.uuid);
    if (!actor) return false;
    // The roller must own the member, or the mech/pilot that rolled for it.
    const roller = data.rollerUuid ? resolveActor(data.rollerUuid) : actor;
    const permitted = user.isGM || actor.testUserPermission(user, "OWNER") || roller?.testUserPermission(user, "OWNER");
    if (!permitted) return false;
    const rows = recordResult(flag.rows, data.uuid, data.total, { rollerUuid: data.rollerUuid ?? null, allowReroll: user.isGM && !!data.reroll });
    if (!rows) return false;
    const { renderGroupCheckContent } = await import("./apps/group-check.js");
    const next = { ...flag, rows };
    await message.update({ content: await renderGroupCheckContent(next), [`flags.${MODULE_ID}.groupCheck`]: next });
    return true;
  });
}

/**
 * Submit a roll result from this client: directly if allowed to update the message, else via GM.
 * @param {ChatMessage} message
 * @param {object} data
 */
export async function submitGroupCheckResult(message, data) {
  const payload = { ...data, messageId: message.id };
  if (message.isOwner) return applyGroupCheckResult(payload, game.user);
  const gm = activeGM();
  if (!gm) {
    ui.notifications.warn(localize("LANCERPARTY.Error.NoGM"));
    return false;
  }
  const response = await gm.query(QUERY_NAME, { action: "groupCheckResult", userId: game.user.id, ...payload });
  return !!response?.ok;
}
