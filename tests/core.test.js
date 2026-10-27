import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { safeMathEval, evalCost } from "../scripts/costs.js";
import { DEG, calcDegree, opposedResult } from "../scripts/checks.js";
import { castSpellCore } from "../scripts/casting.js";
import { clearTargetDictionaryCache, getSpellTargetInfo, getTargetDict } from "../scripts/target-dictionary.js";

const getProperty = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
const setProperty = (object, path, value) => {
  const keys = path.split(".");
  const key = keys.pop();
  keys.reduce((value, key) => value[key], object)[key] = value;
};
let rolls = [];
let messages = [];
let warnings = [];
globalThis.foundry = {
  utils: { getProperty },
  applications: { ux: { TextEditor: { implementation: { enrichHTML: async html => html } } } }
};
globalThis.game = { user: { targets: new Set() }, settings: { get: () => "dictionary.json" } };
globalThis.ui = { notifications: { warn: text => warnings.push(text), error: text => warnings.push(text) } };
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; }
  async roll() { this.total = rolls.shift() ?? 20; return this; }
};
globalThis.ChatMessage = { getSpeaker: () => ({}), create: async data => messages.push(data) };

function makeCaster(costs = {}) {
  const casterActor = {
    uuid: "Actor.caster", isOwner: true,
    system: { attribs: { hp: { value: 12 }, mp: { value: 3 }, san: { value: 60 } }, characteristics: { pow: { value: 60 } } },
    async update(changes) { for (const [path, value] of Object.entries(changes)) setProperty(this, path, value); }
  };
  const spell = { name: "Test <spell>", type: "spell", parent: casterActor, system: { costs, description: { value: "Opis" } } };
  return { casterToken: { document: {} }, casterActor, spell, hasTargetNow: false, variableValue: 0 };
}

test("arithmetic handles precedence, unary minus and rejects malformed input", () => {
  assert.equal(safeMathEval("2 * (3 + 4)"), 14);
  assert.equal(safeMathEval("2*-3+10"), 4);
  assert.equal(safeMathEval("2--3"), 5);
  for (const value of ["1/0", "2+", "(2", "2a", "2(3)"]) {
    assert.throws(() => safeMathEval(value));
  }
});

test("costs combine dice and variable, round down and never pay a negative cost", async () => {
  rolls = [4, 2];
  assert.equal((await evalCost("1d6 + variable * 2 + d4", 3)).amount, 12);
  assert.equal((await evalCost("5/2", 0)).amount, 2);
  assert.equal((await evalCost("-5", 0)).amount, 0);
  assert.equal((await evalCost("variable", -4)).amount, 0);
  assert.equal((await evalCost("ofiara", 0)).amount, 0);
});

test("POW degree boundaries and original opposed tie behavior are preserved", () => {
  for (const [roll, skill, degree] of [[1, 60, DEG.CRIT], [12, 60, DEG.EXTREME], [30, 60, DEG.HARD], [60, 60, DEG.REG], [61, 60, DEG.FAIL], [96, 40, DEG.FUMBLE], [96, 60, DEG.FAIL], [100, 60, DEG.FUMBLE]]) {
    assert.equal(calcDegree(roll, skill), degree);
  }
  assert.equal(opposedResult({ degree: DEG.REG, total: 30 }, { degree: DEG.REG, total: 40 }), "caster");
});

test("casting pays MP shortage from HP and always pays SAN and POW", async () => {
  rolls = [90]; messages = [];
  const options = makeCaster({ hitPoints: "2", magicPoints: "5", sanity: "1", power: "3", others: "ofiara" });
  assert.deepEqual(await castSpellCore(options), { ok: true, outcome: "fail" });
  assert.equal(options.casterActor.system.attribs.mp.value, 0);
  assert.equal(options.casterActor.system.attribs.hp.value, 8);
  assert.equal(options.casterActor.system.attribs.san.value, 59);
  assert.equal(options.casterActor.system.characteristics.pow.value, 57);
  assert.equal(messages.length, 1);
  assert.match(messages[0].content, /Test &lt;spell&gt;/);
  assert.match(messages[0].content, /ofiara/);
});

test("missing target, ownership and costList do not charge the actor", async () => {
  for (const kind of ["target", "owner", "costList"]) {
    const options = makeCaster({ magicPoints: "2" });
    if (kind === "target") options.hasTargetNow = true;
    if (kind === "owner") options.casterActor.isOwner = false;
    if (kind === "costList") options.spell.system.costList = [{}];
    assert.deepEqual(await castSpellCore(options), { ok: false });
    assert.equal(options.casterActor.system.attribs.mp.value, 3);
  }
});

test("opposed POW produces a resisted spell and leaves target resources unchanged", async () => {
  const target = makeCaster().casterActor;
  game.user.targets = new Set([{ actor: target }]);
  rolls = [50, 1];
  const options = makeCaster(); options.hasTargetNow = true;
  assert.deepEqual(await castSpellCore(options), { ok: true, outcome: "resisted" });
  assert.equal(target.system.attribs.hp.value, 12);
  game.user.targets.clear();
});

test("rapid repeated casts charge once while the first cast is pending", async () => {
  const options = makeCaster({ magicPoints: "1" });
  const first = castSpellCore(options);
  assert.deepEqual(await castSpellCore(options), { ok: false });
  await first;
  assert.equal(options.casterActor.system.attribs.mp.value, 2);
});

test("dictionary deduplicates requests, normalizes CoCID and retains explicit false", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return { ok: true, json: async () => [{ spellName: " I.SPELL.TEST ", hasTarget: false }, { spellName: "invalid", hasTarget: "true" }] };
  };
  try {
    clearTargetDictionaryCache();
    await Promise.all([getTargetDict(), getTargetDict()]);
    const info = await getSpellTargetInfo({ flags: { CoC7: { cocidFlag: { id: "i.spell.test" } } } });
    assert.deepEqual(info, { locked: true, hasTarget: false, key: "i.spell.test" });
    assert.equal(requests, 1);
    assert.equal((await getTargetDict()).has("invalid"), false);
    game.settings.get = () => "";
    assert.equal((await getTargetDict()).size, 0);
  } finally {
    globalThis.fetch = originalFetch;
    game.settings.get = () => "dictionary.json";
    clearTargetDictionaryCache();
  }
});

test("manifest entrypoints and template exist", async () => {
  const manifest = JSON.parse(await readFile(new URL("../module.json", import.meta.url)));
  assert.equal(manifest.id, "cthulhu-spell-reader");
  for (const file of [...manifest.esmodules, ...manifest.styles, "templates/spell-dock.hbs"]) {
    assert.ok((await readFile(new URL("../" + file, import.meta.url))).length);
  }
});
