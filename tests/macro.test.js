import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../macros/toggle-spell-reader.js", import.meta.url), "utf8");
// Foundry executes Script macros inside an async function.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runMacro = new AsyncFunction("game", "ui", source);

function setup(module, tool) {
  const warnings = [];
  return {
    game: { modules: new Map([["cthulhu-spell-reader", module]]) },
    ui: { controls: { controls: { tokens: { tools: { "cthulhu-spell-reader": tool } } } }, notifications: { warn: text => warnings.push(text) } },
    warnings
  };
}

test("hotbar macro uses the module API once even when the scene button is available", async () => {
  let calls = 0;
  const api = { async toggle() { assert.equal(this, api); calls++; } };
  const context = setup({ active: true, api }, { onChange() { assert.fail("Do not open twice"); } });
  await runMacro(context.game, context.ui);
  assert.equal(calls, 1);
  assert.deepEqual(context.warnings, []);
});

test("hotbar macro falls back to the hyphenated scene tool and awaits it", async () => {
  let release;
  let started = false;
  let completed = false;
  const pending = new Promise(resolve => { release = resolve; });
  const tool = { async onChange() { assert.equal(this, tool); started = true; await pending; } };
  const context = setup({ active: true, api: { toggle: null } }, tool);
  const running = runMacro(context.game, context.ui).then(() => { completed = true; });
  assert.equal(started, true);
  assert.equal(completed, false);
  release();
  await running;
  assert.equal(completed, true);
  assert.deepEqual(context.warnings, []);
});

test("hotbar macro warns when the module is disabled instead of using a stale scene tool", async () => {
  const context = setup({ active: false }, { onChange() { assert.fail("Disabled module"); } });
  await runMacro(context.game, context.ui);
  assert.equal(context.warnings.length, 1);
  assert.match(context.warnings[0], /Włącz moduł/);
});

test("hotbar macro handles absent scene controls and missing API without throwing", async () => {
  for (const module of [undefined, { active: true }]) {
    const context = setup(module);
    delete context.ui.controls;
    await runMacro(context.game, context.ui);
    assert.equal(context.warnings.length, 1);
  }
});
