# Lancer Party

A Party (squad) actor for the [LANCER system](https://github.com/Eranziel/foundryvtt-lancer) on Foundry VTT v13.

Parties sit at the top of the **Actors** tab as folders. Each one lists its pilots, each pilot's active mech, and any NPC allies. The party sheet shows the whole squad's combat status in one place. It also handles group checks, missions, shared reserves, and party-wide Full Repair and License Level awards.

Features are modelled on the Party in Pathfinder 2e and the group roll cards in Call of Cthulhu 7e. They are reworked around Lancer's mission loop and the link between pilots and mechs.

| | |
|---|---|
| Foundry VTT | v13 (13.341+). Lancer 3.x supports v13 only. |
| System | LANCER 3.0.0 or newer (code was studied against 3.1.3) |
| Languages | English, Русский |
| Lancer system files changed | none |

## Installation

**From a manifest URL** (once a GitHub release exists):

1. In Foundry go to *Add-on Modules → Install Module*.
2. Paste `https://github.com/DIREG502/lancerrpg-party/releases/latest/download/module.json` and install.
3. In your Lancer world: *Game Settings → Manage Modules*, enable **Lancer Party**.

**Manually**: copy this folder to `{userData}/Data/modules/lancer-party/`. The folder name must be `lancer-party`. You only need `module.json`, `scripts/`, `templates/`, `styles/`, `lang/`, `assets/`, `LICENSE`, `README.md` and `CHANGELOG.md`; `node_modules/` and `tests/` are for development. Restart Foundry and enable the module in the world.

On first load in a world without a party, the GM's client creates a party called "Squad" and makes it active. This can be turned off in the settings.

## Using it

### Sidebar (Actors tab)

- **Create a party** with the **Party** button in the Actors tab header, or pick *Party* in the normal *Create Actor* dialog.
- **Add members** by dragging pilots, mechs or NPCs onto the party entry or its sheet. You can also right-click an actor and choose *Add to active party*, or use the **+person** button on the party entry to create a new member.
  - **A mech that has a pilot adds its pilot**, and the mech is listed under them. A mech without a pilot, and NPC allies, join directly. Deployables can't join: they belong to whoever deployed them.
  - Only world actors can join, not token actors. Compendium actors are imported first.
- **Remove members**: right-click a member and choose *Remove from party*, or drag them out of the party into the normal list.
- **Active party** (star): the default target of *Add to active party* and of macros. The GM sets it with the star button or the context menu.
- Party members (and their mechs) are hidden from the rest of the list, as in PF2e. Search still finds them and opens the party entry. Both behaviours can be switched off in the settings.
- Right-click the party entry for the usual actor options: configure ownership, duplicate, delete, export.
- Drag the party to a scene to place a **party token**, for overland or travel maps.

### Party sheet

**Header**: name, image, squad summary (average/min/max License Level, total structure and repair capacity, destroyed mechs, current mission). Toolbar:

| Button | Who | What it does |
|---|---|---|
| Group check | party owner | Asks the squad for a check (see below). |
| Deploy | GM | Places tokens on the current scene around the party token, or the view centre if there is none. Choose *mechs, or pilots without one* / *mechs only* / *pilots only*. Skips actors already on the scene, avoids occupied cells and the scene edge, and can remove the party token afterwards. |
| Recall | GM | Removes the squad's tokens and optionally puts the party token where they were. |
| Add to combat | owner or contributing member, for tokens they own | Adds the squad's tokens on this scene to the encounter. The GM's click creates an encounter if there is none. The party token itself never joins. |
| Full Repair | party owner | One confirmation, then **Lancer's own Full Repair** for each member. A pilot's repair includes the active mech. |
| +1 License Level | GM | Raises each pilot's LL by one (max 12) and posts a summary. Players then spend it on their pilot sheet as usual. |
| −1 License Level | GM | Lowers each pilot's LL by one (minimum 0), for corrections or house rules. |
| End mission | GM | Logs the mission with its outcome, optionally runs Full Repair, +1 LL, resets clocks, clears objectives, starts the next mission number and posts a summary. |
| Post roster | owner or contributing member | Posts the squad and mech status to chat. |

**Squad tab**: one card per member. For pilots: callsign, LL, player, a free-text squad role, HP, grit and statuses. For the active mech: frame, HP (+overshield), heat, structure/stress/repair pips, core power, burn, overcharge, evasion, E-defense, armor, speed, sensors, save, tech attack and statuses. A warning icon appears if the pilot↔mech link is one-sided; Lancer only passes pilot bonuses when both sides point at each other. Drag cards to the canvas to place tokens, or onto each other to reorder.

**Mission tab**: mission number, name, SITREP, status and briefing. Objectives with checkboxes. Progress and threat **clocks** (4–12 segments): click for +1, right-click or Shift-click for −1. The GM can hide objectives and clocks from players. The mission log lists completed missions.

**Reserves tab**: shared **manna** and a pool of reserves/items. Drop Lancer items (reserves, pilot gear, …) here. Items dragged from a sheet you own are moved; items from the sidebar or a compendium are copied. *Give to pilot* creates the item on a pilot you own and removes one from the pool. You can also add hand-written reserves.

**Notes tab**: rich-text notes.

### Group checks

The *Group check* button opens a dialog:

- **Check**: a mech skill (Hull/Agility/Systems/Engineering), any skill trigger any member pilot has, Grit, or a plain d20.
  - Mech skills are rolled by the pilot's active mech, or by the pilot if they have none.
  - Pilots without the chosen trigger roll a plain d20, as in the core rules.
- **Squad result**: individual results, everyone must succeed, one success is enough, or the majority must succeed.
- **Who rolls**.

A chat card lists everyone. Each player clicks **Roll** on their own row. The roll goes through **Lancer's StatRollFlow**, so players get Lancer's accuracy/difficulty HUD and Lancer's normal roll card. The total (≥ 10 succeeds) is written back to the group card, which shows the tally and the squad outcome as soon as it's decided. The GM can re-roll any row.

### Permissions and multiplayer

- Parties are normal actors with normal ownership. New parties give all players the access chosen in *Default player access* (Observer by default). Players with Limited access see names and portraits only.
- **Players who own a member** can tick clocks, check objectives, add objectives and clocks, manage reserves and manna, and set their own member's role, even without owning the party (setting *Players can update party tracking*). These requests go to the active GM's client through Foundry v13's `User#query`, so **a GM must be connected**. The GM re-checks permissions and applies each change to the party's current data, one request at a time, so simultaneous edits don't overwrite each other.
- Only owners can rename the party, edit the mission and notes, add or remove members, or delete things. Hidden clocks and objectives are GM-only.
- *Who sees squad stats*: everyone (default; squadmates share telemetry), or only users with Observer permission on that actor.
- Everything lives in the party actor's data (`system.*`) and in chat message flags, so it is saved in the world and synced by Foundry like any other actor.

### Settings

| Setting | Default |
|---|---|
| Hide party members elsewhere in the Actors tab | on |
| Show pilots' mechs in the sidebar | on |
| Who sees squad stats | everyone |
| Players can update party tracking | on |
| Default player access to new parties | Observer |
| Create a party in new worlds | on |

### Macro API

```js
const lp = game.modules.get("lancer-party").api;
const party = lp.getActiveParty();
await lp.addMembers(party, game.actors.getName("Ada"));
await lp.requestGroupCheck(party, { check: "hase:agi", mode: "all", prompt: false });
await lp.fullRepair(party);
lp.openSheet(party);
// Also: getParties, setActiveParty, createParty, removeMembers, awardLicenseLevel, deploy, recall,
// addToCombat, postRoster, endMission, stashItem, requestOp(party, {type: "clock.tick", id, delta: 1})
```

The `lancer-party.ready` hook fires with the API once the module is ready.

## Look and feel

The party sheet uses the visual language of [Lancer Alternative Sheets](https://github.com/annoyedb/lancer-alternative-sheets):

- a header band in the primary colour, with a terminal-style readout and navy tab buttons;
- a dark statistics sidebar with hexagon badges, paired HP/structure and heat/stress meters, and the squad actions as a macro-style list;
- colour-coded section bars, dark item rows with underlined titles, and tagged "effect" boxes.

Each pilot's card shows the active mech's meters and stats next to the pilot's GRIT and HASE hexes. Colours follow the Lancer system's **UI Theme** setting (GMS, GMS Dark, HORUS, HA, IPS-N, SSC, MSMC, GALSIM), using the COMP/CON manufacturer palettes. Stat icons come from the COMP/CON glyph font that Lancer already loads.

The styles are written from scratch for this module: Lancer Alternative Sheets is GPL-3.0, and no code was copied from it. Noto Sans and JetBrains Mono are bundled under the SIL Open Font License; see `assets/fonts/OFL.txt`.

## Design notes and decisions

What was adopted, changed or left out after reading the PF2e and CoC7 sources and the Lancer 3.1.3 system:

- **PF2e** (party actor, members by UUID, folder-like sidebar entries, hidden members, active party, first party auto-created, members' players editing the shared stash through the GM, Limited/Observer visibility of stats). Adopted, but:
  - Lancer has no exploration activities, kingdom or coin/bulk inventory. They are replaced by missions, clocks, objectives, reserves and manna.
  - "Rest" is Lancer's Full Repair, run through Lancer's own flow step so the result matches the system exactly.
  - The overview shows mech telemetry (structure, stress, heat, repairs, core power) instead of AC/saves/skills.
  - Party token placement was added (Deploy/Recall), modelled loosely on dnd5e's *Place Members*.
- **CoC7**: its current source (develop and master branches) has **no Party actor**. What it does have for groups is the combined roll card ("any/all must succeed") and Keeper roll requests. That idea became the **group check card**, using Lancer's rules: d20 vs 10, rolled through Lancer's StatRollFlow, with a "majority" mode added.
- **Lancer specifics**: the pilot is the member and the active mech hangs off it. A dropped mech is redirected to its pilot. One-sided pilot↔mech links are flagged. Mech skills roll with the mech. LL awards respect the cap of 12. Deployables are excluded.
- **No Lancer files are modified or patched.** The module adds an Actor sub-type through `documentTypes` in `module.json` (type id `lancer-party.party`) with its own data model and ApplicationV2 sheet. It subclasses whatever `CONFIG.ui.actors` and `CONFIG.Actor.collection` are at init, so it composes with other modules that do the same. Lancer's `LancerActor` class still handles the party, and the data model supplies the few things LancerActor reads from every actor (`full_update_data`, `statuses`, `resistances`, `size`).
- Reserves are stored as data on the party, not as embedded items, so Lancer's item preparation never runs against a party.
- Player edits use v13's `User#query` instead of a raw socket, and each change is a small operation applied on the GM's client in order.
- Compatibility is declared as Foundry 13.341–13 and Lancer ≥ 3.0.0, the first Lancer release with v13 support. Lancer 3.1.3 itself declares maximum 13.

## Known limitations

- Lancer logs `Actor is not a LancerActor: …` to the console (`console.log`, not an error) whenever a party's data is prepared. The message comes from Lancer's own `prepareBaseData`, which skips non-Lancer types this way. It's harmless and can't be silenced without patching Lancer.
- Foundry doesn't tell a query handler who sent a request. The requesting user's id travels in the payload, and the GM checks that user's permissions. Players can only send the listed member operations. This is a convenience boundary for a trusted table, not a security boundary.
- Deploy uses square-grid offsets. On hex grids, tokens larger than size 1 may be spaced a little loosely; adjust by hand.
- If the module is disabled, party actors become invalid documents for Foundry and are hidden until it is re-enabled. Their data is kept.

## Development

```bash
npm install
npm run verify
```

`npm run verify` runs a static package check and the Node test suite:

- The package check covers the manifest, file references, syntax of every script, template compilation, en/ru key and placeholder parity, and every localization key used.
- The test suite covers pure logic and the Foundry-facing modules against a minimal mock of Foundry globals, and renders every template.

These tests don't replace a run in Foundry; see the checklist in CHANGELOG.md.

## License

MIT, see [LICENSE](LICENSE). "Lancer for FoundryVTT" and *Lancer* are separate works by their authors (Massif Press for *Lancer*); this module is not affiliated with them.
