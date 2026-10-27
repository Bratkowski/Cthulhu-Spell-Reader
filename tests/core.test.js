import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { castSpell } from "../scripts/casting.js";
import { getSpellCosts } from "../scripts/costs.js";

globalThis.game = { i18n: { localize: key => key } };
globalThis.CONFIG = { Item: { dataModels: { spell: {
  availableCosts: () => [{ key: "mp", name: "Punkty Magii" }, { key: "pow", name: "MOC" }, { key: "san", name: "Poczytalność" }]
} } } };
globalThis.ui = { notifications: { warn() {}, error() {} } };
globalThis.Roll = class { constructor() { throw Error("Module must not roll dice"); } };
globalThis.ChatMessage = { create() { throw Error("Module must not create spell chat messages"); } };

function makeSpell(cast = async () => {}) {
  return {
    type: "spell",
    actor: { uuid: "Actor.caster", isOwner: true, update() { throw Error("Module must not deduct resources"); } },
    system: { cast, costList: [] }
  };
}

test("Test Cast calls the native system method with true and preserves its receiver", async () => {
  const spell = makeSpell();
  let calls = 0;
  spell.system.cast = async function (hidden) {
    assert.equal(this, spell.system);
    assert.equal(hidden, true);
    calls++;
  };
  assert.equal(await castSpell(spell), true);
  assert.equal(calls, 1);
});

test("native casting supports costList and legacy spells without rolling or charging locally", async () => {
  let calls = 0;
  const spell = makeSpell(async () => { calls++; });
  spell.system.costList = [{ type: "casterCost", config: { modify: "mp", value: "@amount" } }];
  await castSpell(spell);
  spell.system.costList = [];
  spell.system.costs = { magicPoints: "1d6" };
  await castSpell(spell);
  assert.equal(calls, 2);
});

test("unowned items and missing native methods never cast", async () => {
  let calls = 0;
  const spell = makeSpell(async () => { calls++; });
  spell.actor.isOwner = false;
  assert.equal(await castSpell(spell), false);
  spell.actor.isOwner = true;
  spell.system.cast = null;
  assert.equal(await castSpell(spell), false);
  assert.equal(calls, 0);
});

test("a pending native prompt cannot be launched twice for the same actor", async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const spell = makeSpell(() => pending);
  const first = castSpell(spell);
  assert.equal(await castSpell(spell), false);
  assert.equal(await castSpell({ ...spell, system: { cast: async () => assert.fail("Second spell cast") } }), false);
  release();
  assert.equal(await first, true);
  assert.equal(await castSpell(makeSpell()), true);
});

test("system errors release the casting lock", async () => {
  const original = console.error;
  console.error = () => {};
  try { assert.equal(await castSpell(makeSpell(async () => { throw Error("Native error"); })), false); }
  finally { console.error = original; }
  assert.equal(await castSpell(makeSpell()), true);
});

test("preview preserves step order, formulas, conditions and additional caster configuration", () => {
  const costList = [
    { type: "promptRequireNumber", if: "", config: { prompt: "Ile punktów?", variable: "amount" } },
    { type: "triggerPrompt", if: "", config: {} },
    { type: "casterCost", if: "!@free", config: { modify: "mp", value: "2D6 + @amount" } },
    { type: "additionalCasterPromptAdd", if: "@group", config: { prompt: "Pomocnicy", variable: "casters", min: 0, step: 2 } },
    { type: "additionalCasterCost", if: "", config: { modify: "pow", value: "@casters.mp" } }
  ];
  const before = JSON.stringify(costList);
  const view = getSpellCosts({ system: { costList, costs: { magicPoints: "999" } } });
  assert.equal(JSON.stringify(costList), before);
  assert.equal(view.automated, true);
  assert.deepEqual(view.legacy, []);
  assert.deepEqual(view.steps.map(step => step.number), [1, 2, 3, 4, 5]);
  assert.equal(view.steps[2].condition, "!@free");
  assert.equal(view.steps[2].fields.find(field => field.formula).value, "2D6 + @amount");
  assert.equal(view.steps[2].fields[0].value, "Punkty Magii");
  assert.ok(view.steps[3].fields.some(field => field.value === "0"));
});

test("every documented step has a readable preview, including variable display aliases", () => {
  const types = ["additionalCasterPromptAdd", "additionalCasterCost", "additionalCasterPromptRequireNumber", "additionalInformation", "castingTime", "casterCost", "promptRequireNumber", "promptShowText", "showVariable", "promptShowVariable", "promptToggleButton", "setVariable", "triggerPrompt"];
  const view = getSpellCosts({ system: { costList: types.map(type => ({ type, if: "", config: { prompt: "Opis", value: "@x", variable: "x" } })) } });
  view.steps.forEach((step, index) => {
    assert.ok(step.title && step.title !== types[index]);
    assert.ok(step.fields.some(field => field.value === "@x"));
  });
});

test("legacy display shows only nonzero costs; unknown step fields remain visible", () => {
  const view = getSpellCosts({ system: { costs: { magicPoints: "0", sanity: "1D4", others: "Ofiara", power: "" } } });
  assert.equal(view.automated, false);
  assert.deepEqual(view.legacy.map(row => row.value), ["1D4", "Ofiara"]);
  const unknown = getSpellCosts({ system: { costList: [{ type: "futureStep", if: "@x", config: { option: { nested: 2 } } }] } });
  assert.equal(unknown.steps[0].fields[0].value, '{"nested":2}');
});

test("system translations are used for step labels", () => {
  const original = game.i18n.localize;
  game.i18n.localize = key => key === "CoC7.Spell.Cost.CasterCost" ? "Caster cost" : key;
  try { assert.equal(getSpellCosts({ system: { costList: [{ type: "casterCost", config: {} }] } }).steps[0].title, "Caster cost"); }
  finally { game.i18n.localize = original; }
});

test("manifest and all templates exist", async () => {
  const manifest = JSON.parse(await readFile(new URL("../module.json", import.meta.url)));
  assert.equal(manifest.version, "0.3.0");
  for (const file of [...manifest.esmodules, ...manifest.styles, "templates/spell-dock.hbs", "templates/spell-preview.hbs", "templates/spell-costs.hbs", "templates/spell-tooltip.hbs"]) {
    assert.ok((await readFile(new URL("../" + file, import.meta.url))).length);
  }
});
