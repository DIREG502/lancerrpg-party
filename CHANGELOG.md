# Changelog

## 1.2.0 (2026-11-05)

### Fixed

- The **Mission**, **Reserves** and **Notes** tabs couldn't be opened. The tab buttons are now handled by the module itself instead of relying on Foundry's built-in tab handler, which ignored clicks on the button's label.
- **Change party image** did nothing: Foundry's built-in image editor only works on an `<img>` element. The header now shows a clickable portrait that opens the file picker and saves the image directly.

### Added

- **−1 License Level** action (GM): lowers every member pilot's License Level by one, minimum 0, with a confirmation and a chat summary.

## 1.1.0 (2026-11-05)

### Changed

- **New party sheet design**, modelled on Lancer Alternative Sheets:
  - header band with a terminal readout, and the tabs moved into the header;
  - dark statistics sidebar with a hex cluster for average/range License Level, squad and mech count, squad-wide meters, and the party actions as a macro-style list;
  - section bars, dark item rows and tagged effect boxes on the Mission, Reserves and Notes tabs;
  - member cards with mech meters, a stat line using COMP/CON icons, and the pilot's GRIT/HASE hexes.
- Colours follow the Lancer system's UI Theme (8 manufacturer palettes). Threat clocks are always red.
- Chat cards and Actors-tab party folders restyled to match.
- Bundled Noto Sans and JetBrains Mono (Latin + Cyrillic, SIL OFL 1.1).
- Russian stat abbreviations shortened to fit.

## 1.0.0 (2026-11-05)

First release.

### Features

- **Party actor** (`lancer-party.party`) for LANCER 3.x on Foundry v13, added via `documentTypes` with its own TypeDataModel and ApplicationV2 sheet. No Lancer files are changed.
- **Actors tab**:
  - Parties appear as folder-like entries at the top, with the active party first and starred.
  - Pilots show callsign, License Level and their active mech, which is listed (and draggable) under them. NPC allies are supported.
  - Drag onto a party to add, drag out to remove; context menu for *Add to active party*, *Remove from party* and *Make active party*; a *Party* create button; per-user expanded state.
  - Members are hidden elsewhere in the tab (optional), and search reveals them inside their party.
- **Membership rules for Lancer**: a piloted mech adds its pilot; unpiloted mechs and NPCs join directly; deployables, token actors and other parties are refused; deleted actors are removed from parties by the GM's client.
- **Party sheet**:
  - **Squad**: pilot and mech status cards with HP, heat, structure/stress/repair pips, core power, burn, overcharge, defensive stats, statuses, roles and a broken-link warning.
  - **Mission**: number, name, SITREP, status and briefing; objectives; progress and threat clocks; mission log.
  - **Reserves**: manna, plus shared reserves and items with give-to-pilot.
  - **Notes**.
- **Group checks**: mech skill, skill trigger, Grit or plain d20, with each/all/any/majority modes. Rolled by each player through Lancer's StatRollFlow and collected on one chat card. The GM can re-roll a row.
- **Party actions**:
  - Full Repair through Lancer's own flow step.
  - +1 License Level (capped at 12).
  - Deploy tokens around the party token or the view centre; Recall them back into a party token.
  - Add to combat.
  - Post roster.
  - End mission: log, repair, LL, reset clocks, clear objectives, next mission, chat summary.
- **Multiplayer**: players who own a member can update clocks, objectives, reserves, manna and their own role. Their changes go to the GM's client through v13's `User#query` and are applied one operation at a time against current data.
- **Settings**: hide members, show mechs, stats visibility, member editing, default ownership, auto-create first party.
- **Localization**: English and Russian.
- **Macro API** at `game.modules.get("lancer-party").api`, plus a `lancer-party.ready` hook.

### Decisions made during development

- CoC7 (current develop/master) has no Party actor, so the adopted CoC7 idea is its combined "any/all must succeed" roll card, rebuilt for Lancer's d20-vs-10 checks.
- Lancer's per-actor Full Repair confirmation is replaced by one party-level confirmation. The repair itself is Lancer's `executeFullRepair` step, which also removes unequipped items; the dialog says so.
- Reserves are stored as data (with the original item data) instead of embedded Items, so Lancer's item preparation never runs on a party actor.
- The data model supplies `full_update_data`, `statuses`, `resistances` and `size`, which `LancerActor` and `LancerTokenDocument` read from every actor.
- Compatibility declared as Foundry 13.341–13 and Lancer ≥ 3.0.0 (first Lancer release with v13 support; 3.1.3 is the newest checked).

### Verified in development (without Foundry)

- `npm run check`: manifest, referenced files, syntax of every script, template compilation, en/ru key and placeholder parity, every localization key used is defined, no hard-coded notification text.
- `npm test`: 78 tests. They cover membership rules, party operations and permissions, clock geometry, formation planning, group check scoring, Lancer data adapters, the data model, the GM relay (including serialised concurrent edits and no-GM handling), directory tree filtering and rendering of every template, and a boot test that runs the `init` hook against the mock.

### Needs checking in a real Foundry v13 + Lancer 3.1.x world

None of the following has been run in Foundry yet:

- [ ] Module enables without console errors; *Party* appears in Create Actor; the default party is created and starred.
- [ ] Sidebar: party entries render at the top and expand/collapse (state survives reload); members are hidden from the main list immediately after adding and reappear after removing; drag in/out of a party works; context menu entries work; search reveals members inside their party; folder context menu is not shown on party headers.
- [ ] Party sheet opens for GM and players (Observer and Limited); tabs switch; image, name, mission fields, briefing and notes (ProseMirror) save; reorder by dragging cards.
- [ ] Player (owner of a member, not the party) can tick clocks, toggle and add objectives, add and give reserves, change manna and set their role while a GM is online, and gets a warning when no GM is online. The change appears on all clients.
- [ ] Group check: players see Roll only on their rows; Lancer's accuracy HUD opens; results land on the card for players and GM; outcome is correct; GM re-roll works.
- [ ] Full Repair, +1 LL, End mission (each option), Deploy (square and hex grid, with and without a party token), Recall, Add to combat (with and without an existing encounter).
- [ ] Party token on a scene: no Lancer errors when selecting it, applying a status from the Token HUD, or with Lancer's token-size automation on.
- [ ] Data persists across reloads; deleting a member actor removes it from parties; disabling and re-enabling the module keeps parties.
- [ ] Russian UI strings fit their buttons and labels.
