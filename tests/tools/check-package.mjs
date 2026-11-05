#!/usr/bin/env node
/**
 * Static package checks (no Foundry needed):
 *  - module.json is valid and every file it references exists
 *  - every JS file parses (node --check)
 *  - every template referenced from code exists and compiles with Handlebars
 *  - en/ru have identical key sets and placeholders
 *  - every localization key used in code/templates exists, including keys built dynamically
 *
 * Usage: node tests/tools/check-package.mjs   (exit code 1 on any problem)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";

import * as C from "../../scripts/constants.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const problems = [];
const fail = msg => problems.push(msg);
const read = p => readFileSync(join(root, p), "utf8");
const walk = (dir, ext) => readdirSync(join(root, dir)).flatMap(name => {
  const rel = join(dir, name);
  return statSync(join(root, rel)).isDirectory() ? walk(rel, ext) : rel.endsWith(ext) ? [rel.replaceAll("\\", "/")] : [];
});

/* ---------- manifest ---------- */
let manifest;
try {
  manifest = JSON.parse(read("module.json"));
} catch (err) {
  fail(`module.json does not parse: ${err.message}`);
}
if (manifest) {
  for (const key of ["id", "title", "description", "version", "compatibility", "esmodules", "languages"]) {
    if (!(key in manifest)) fail(`module.json: missing "${key}"`);
  }
  if (manifest.id !== C.MODULE_ID) fail(`module.json id "${manifest.id}" != MODULE_ID "${C.MODULE_ID}"`);
  if (!manifest.documentTypes?.Actor?.[C.PARTY_SUBTYPE]) fail(`module.json: documentTypes.Actor.${C.PARTY_SUBTYPE} missing`);
  if (String(manifest.compatibility?.maximum) !== "13") fail("module.json: compatibility.maximum should be 13");
  const lancer = manifest.relationships?.systems?.find(s => s.id === "lancer");
  if (!lancer) fail("module.json: relationships.systems must require lancer");
  for (const file of [...(manifest.esmodules ?? []), ...(manifest.styles ?? []), ...(manifest.languages ?? []).map(l => l.path), manifest.readme, manifest.license, manifest.changelog].filter(Boolean)) {
    if (!existsSync(join(root, file))) fail(`module.json references missing file ${file}`);
  }
  for (const lang of ["en", "ru"]) {
    if (!manifest.languages?.some(l => l.lang === lang)) fail(`module.json: language ${lang} not declared`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) fail(`module.json: version "${manifest.version}" is not semver`);
  if (manifest.download && !manifest.download.includes(`v${manifest.version}`)) fail("module.json: download URL doesn't match version");
  const pkg = JSON.parse(read("package.json"));
  if (pkg.version !== manifest.version) fail(`package.json version ${pkg.version} != module.json ${manifest.version}`);
}

/* ---------- JS syntax ---------- */
const scripts = walk("scripts", ".js");
for (const file of scripts) {
  try {
    execFileSync(process.execPath, ["--check", join(root, file)], { stdio: "pipe" });
  } catch (err) {
    fail(`Syntax error in ${file}:\n${err.stderr?.toString() ?? err.message}`);
  }
}

/* ---------- templates ---------- */
const templates = walk("templates", ".hbs");
const code = scripts.map(f => [f, read(f)]);
const referenced = new Set();
for (const [, src] of code) {
  for (const m of src.matchAll(/\$\{TEMPLATES\}\/([\w/-]+\.hbs)/g)) referenced.add(`templates/${m[1]}`);
}
for (const ref of referenced) if (!templates.includes(ref)) fail(`Template referenced in code but missing: ${ref}`);
for (const t of templates) if (!referenced.has(t)) fail(`Template never referenced from code: ${t}`);
for (const t of templates) {
  try {
    Handlebars.precompile(read(t), { strict: false });
  } catch (err) {
    fail(`Template ${t} does not compile: ${err.message}`);
  }
}

/* ---------- i18n ---------- */
const flatten = (obj, prefix = "", out = {}) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = v;
  }
  return out;
};
const langs = {};
for (const lang of ["en", "ru"]) {
  try {
    langs[lang] = flatten(JSON.parse(read(`lang/${lang}.json`)));
  } catch (err) {
    fail(`lang/${lang}.json does not parse: ${err.message}`);
  }
}
const placeholders = s => [...new Set([...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]))].sort().join(",");
if (langs.en && langs.ru) {
  for (const key of Object.keys(langs.en)) {
    if (!(key in langs.ru)) fail(`ru.json missing key ${key}`);
    else if (placeholders(langs.en[key]) !== placeholders(langs.ru[key])) fail(`Placeholder mismatch for ${key}: en {${placeholders(langs.en[key])}} vs ru {${placeholders(langs.ru[key])}}`);
    if (!String(langs.en[key]).trim()) fail(`en.json empty value for ${key}`);
  }
  for (const key of Object.keys(langs.ru)) if (!(key in langs.en)) fail(`en.json missing key ${key} (present in ru)`);
  if (langs.en[`TYPES.Actor.${C.PARTY_TYPE}`] === undefined) fail(`Type label TYPES.Actor.${C.PARTY_TYPE} missing`);

  // Static keys in code and templates.
  const used = new Set();
  const sources = [...code, ...templates.map(t => [t, read(t)])];
  for (const [, src] of sources) {
    for (const m of src.matchAll(/["'`](LANCERPARTY\.[A-Za-z0-9_.]+)["'`]/g)) {
      if (!m[1].endsWith(".")) used.add(m[1]);
    }
  }
  // Settings use a helper: L("HideMembers.Name").
  for (const m of read("scripts/settings.js").matchAll(/L\("([\w.]+)"\)/g)) used.add(`LANCERPARTY.Settings.${m[1]}`);
  // Keys assembled at runtime from constant lists.
  const dynamic = [
    ...C.HASE.map(k => `LANCERPARTY.HASE.${k}`),
    ...C.CHECK_MODES.map(k => `LANCERPARTY.Check.Mode.${k}`),
    ...["success", "failure"].map(k => `LANCERPARTY.Check.Outcome.${k}`),
    ...C.MISSION_STATUSES.map(k => `LANCERPARTY.MissionStatus.${k}`),
    ...C.MISSION_OUTCOMES.map(k => `LANCERPARTY.Outcome.${k}`),
    ...C.CLOCK_KINDS.map(k => `LANCERPARTY.Clock.Kind.${k}`),
    ...["squad", "mission", "reserves", "notes"].map(k => `LANCERPARTY.Tab.${k}`),
    ...["denied", "invalid", "notFound"].map(k => `LANCERPARTY.Error.Op.${k}`)
  ];
  for (const key of dynamic) used.add(key);
  const definedKeys = Object.keys(langs.en);
  for (const key of used) {
    // A label prefix (e.g. tab labelPrefix) is fine if keys exist under it.
    if (!(key in langs.en) && !definedKeys.some(k => k.startsWith(`${key}.`))) fail(`Localization key used but not defined: ${key}`);
  }
  const unused = Object.keys(langs.en).filter(k => k.startsWith("LANCERPARTY.") && !used.has(k));
  if (unused.length) console.log(`note: ${unused.length} defined key(s) not found by the static scan:\n  ${unused.join("\n  ")}`);
}

/* ---------- user-facing literals ---------- */
// Notifications must not contain hard-coded English.
for (const [file, src] of code) {
  for (const m of src.matchAll(/ui\.notifications\??\.(?:info|warn|error)\(\s*["'`](?!LANCERPARTY)/g)) {
    fail(`${file}: notification with a literal string at index ${m.index}`);
  }
}

/* ---------- result ---------- */
if (problems.length) {
  console.error(`✗ ${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`✓ module.json, ${scripts.length} scripts, ${templates.length} templates, ${Object.keys(langs.en ?? {}).length} i18n keys (en/ru) OK`);
console.log(`  root: ${relative(process.cwd(), root) || "."}`);
