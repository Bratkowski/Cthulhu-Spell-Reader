// Optional UI check: requires Playwright, Handlebars and an installed Chromium.
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const handlebarsPath = require.resolve(process.env.HANDLEBARS_MODULE || "handlebars/dist/handlebars.js");

(async () => {
  const root = path.resolve(__dirname, "..");
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("http://spell-reader.test/**", async route => {
      const requested = new URL(route.request().url()).pathname;
      if (requested === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><script src="/handlebars.js"></script><link rel="stylesheet" href="/styles/spell-dock.css"></head><body><div id="hotbar" style="height:50px"></div></body></html>' });
      if (requested === "/handlebars.js") return route.fulfill({ contentType: "text/javascript", body: await fs.readFile(handlebarsPath) });
      const file = path.resolve(root, "." + decodeURIComponent(requested));
      if (!file.startsWith(root + path.sep)) return route.abort();
      try {
        await route.fulfill({ contentType: requested.endsWith(".js") ? "text/javascript" : requested.endsWith(".css") ? "text/css" : "text/plain", body: await fs.readFile(file) });
      } catch { await route.fulfill({ status: 404, body: "" }); }
    });
    await page.goto("http://spell-reader.test/");
    await page.evaluate(async () => {
      window.Hooks = {
        events: new Map(),
        on(name, fn) { const list = this.events.get(name) ?? new Set(); list.add(fn); this.events.set(name, list); },
        off(name, fn) { this.events.get(name)?.delete(fn); }
      };
      const flags = {};
      window.game = { user: {
        isGM: true,
        getFlag: (scope, key) => flags[scope + "." + key],
        setFlag: async (scope, key, value) => { flags[scope + "." + key] = value; }
      }, i18n: { localize: key => key } };
      window.CONFIG = { Item: { dataModels: { spell: { availableCosts: () => [{ key: "mp", name: "Punkty Magii" }, { key: "pow", name: "MOC" }] } } } };
      window.ui = { notifications: { warn: console.log, error: console.error } };
      window.foundry = {
        utils: { getProperty: (obj, key) => key.split(".").reduce((v, k) => v?.[k], obj) },
        applications: {
          ux: { TextEditor: { implementation: { enrichHTML: async raw => raw } } },
          handlebars: { renderTemplate: async (url, data) => Handlebars.compile(await (await fetch("/" + url.split("/").slice(2).join("/"))).text())(data) }
        }
      };
      window.actor = {
        uuid: "Actor.test", isOwner: true, name: "Eldridge Strong",
        system: { attribs: { hp: { value: 26 }, mp: { value: 5 }, san: { value: 63 } }, characteristics: { pow: { value: 60 } } },
        items: [],
        update() { throw Error("Module tried to deduct resources"); }
      };
      window.nativeCalls = [];
      window.sheetCalls = [];
      const names = ["Zaczarowany nóż", "Przywołanie mgły", "Szept otchłani", "Znak Starszych Bogów", "Brama snów", "Oko w ciemności", "Kontakt z głębiną", "Ochronny krąg"];
      actor.items = names.map((name, index) => {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="280"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(${index * 35 + 220},35%,10%)"/><stop offset="1" stop-color="hsl(${index * 35 + 240},40%,35%)"/></linearGradient></defs><rect width="180" height="280" fill="url(#g)"/><circle cx="90" cy="110" r="48" fill="none" stroke="#c9b59a" stroke-width="1"/><path d="M90 50 L108 150 L52 88 L128 88 L72 150 Z" fill="none" stroke="#c9b59a"/><circle cx="90" cy="110" r="3" fill="#eee"/></svg>`;
        return {
          id: "spell" + index, name, img: "data:image/svg+xml," + encodeURIComponent(svg), type: "spell", parent: actor,
          sheet: { async render(options) { sheetCalls.push({ id: "spell" + index, options }); } },
          flags: { CoC7: { cocidFlag: { id: "i.spell.example-" + index } } },
          system: {
            costs: { magicPoints: "999" },
            costList: [
              { type: "promptRequireNumber", if: "", config: { prompt: "Ile punktów magii poświęcasz?", variable: "amount" } },
              { type: "triggerPrompt", if: "", config: {} },
              { type: "casterCost", if: "!@free", config: { modify: "mp", value: "2D6 + @amount" } },
              { type: "casterCost", if: "@permanent", config: { modify: "pow", value: "1" } }
            ],
            castingTime: "2 godziny", type: { enchantment: true },
            description: { value: "<p>Starożytny rytuał wiąże moc zaklęcia z wybranym przedmiotem. Zapisane symbole migoczą w półmroku, gdy rzucający wypowiada ostatnie słowa inkantacji.</p><p>Przygotowanie wymaga skupienia i odpowiedniego miejsca. Koszty oraz odpowiedzi na pytania zostaną rozliczone przez system.</p><p><a class='inline-roll' href='#'>1d6</a></p>" },
            async cast(hidden) { nativeCalls.push({ id: "spell" + index, hidden }); }
          }
        };
      });
      window.dockModule = await import("/scripts/spell-dock.js");
      await dockModule.openDock({ casterActor: actor });
    });
    assert.equal(await page.locator(".spell-card").count(), 8);
    assert.equal(await page.locator(".spell-card button").count(), 0);
    const layout = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".spell-card")];
      const selected = cards[0].getBoundingClientRect();
      const next = cards[1].getBoundingClientRect();
      return { gap: next.left - selected.right, selected: selected.width, regular: next.width, radius: getComputedStyle(cards[0]).borderRadius };
    });
    assert.ok(Math.abs(layout.gap) < 1);
    assert.ok(layout.selected > layout.regular);
    assert.equal(layout.radius, "0px");
    const shell = await page.locator("#coc7-spell-dock").evaluate(element => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, border: style.borderWidth, shadow: style.boxShadow };
    });
    assert.deepEqual(shell, { background: "rgba(0, 0, 0, 0)", border: "0px", shadow: "none" });
    assert.equal(await page.locator('.dock-carousel').evaluate(element => getComputedStyle(element).backgroundColor), "rgba(25, 25, 25, 0.94)");
    const fullArrow = await page.locator('[data-action="right"]').boundingBox();
    const regularCard = await page.locator('.spell-card:not(.selected)').first().boundingBox();
    assert.ok(Math.abs(fullArrow.height - regularCard.height) < 1);
    assert.equal(await page.locator('.dock-details [data-panel="description"]').isVisible(), true);
    assert.equal(await page.locator('.dock-details [data-panel="costs"]').isVisible(), false);
    await page.locator('.dock-details [data-action="open-item"]').click();
    assert.deepEqual(await page.evaluate(() => sheetCalls), [{ id: "spell0", options: { force: true } }]);
    assert.equal(await page.evaluate(() => nativeCalls.length), 0);
    await page.locator('.dock-details [data-tab="costs"]').click();
    assert.equal(await page.locator(".dock-details .cost-step").count(), 4);
    assert.match(await page.locator('.dock-details [data-panel="costs"]').innerText(), /2D6 \+ @amount/);
    assert.match(await page.locator('.dock-details [data-panel="costs"]').innerText(), /!@free/);
    assert.doesNotMatch(await page.locator('.dock-details [data-panel="costs"]').innerText(), /999/);
    assert.equal(await page.evaluate(() => nativeCalls.length), 0);
    await page.locator('.spell-card[data-spell-id="spell1"]').click();
    await page.waitForSelector('.dock-details [data-panel="description"]:visible');
    assert.equal(await page.locator('.dock-details [data-panel="costs"]').isVisible(), false);
    await page.locator('.dock-details [data-action="open-item"]').click();
    assert.deepEqual(await page.evaluate(() => sheetCalls.at(-1)), { id: "spell1", options: { force: true } });
    await page.locator('.dock-details [data-action="cast"]').click();
    await page.waitForFunction(() => nativeCalls.length === 1);
    assert.deepEqual(await page.evaluate(() => nativeCalls[0]), { id: "spell1", hidden: true });
    await page.locator('.dock-details [data-tab="description"]').focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator('.dock-details [data-panel="costs"]').isVisible(), true);
    await fs.mkdir(path.join(root, ".local"), { recursive: true });
    await page.screenshot({ path: path.join(root, ".local/costs-v030.png") });
    await page.locator('.dock-details [data-tab="description"]').click();
    await page.screenshot({ path: path.join(root, ".local/description-v030.png") });
    // Full-view navigation must preserve the exact preview and never snap back.
    await page.setViewportSize({ width: 600, height: 1000 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.locator('.spell-card[data-spell-id="spell0"]').click();
    await page.waitForSelector('.dock-details [data-tab="costs"]');
    await page.locator('.dock-details [data-tab="costs"]').click();
    const fullContext = await page.locator('.dock-details').evaluate(element => {
      const body = element.querySelector('.preview-body');
      body.scrollTop = 40;
      window.contextBeforeBrowse = element.querySelector('[data-panel="costs"]');
      return { html: element.innerHTML, scrollTop: body.scrollTop };
    });
    await page.locator('[data-action="right"]').click();
    await page.waitForFunction(() => {
      const track = document.querySelector('.car-track');
      return track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
    });
    assert.equal(await page.locator('.spell-card.selected').getAttribute('data-spell-id'), 'spell0');
    const fullBrowse = await page.locator('.car-track').evaluate(track => {
      const bounds = track.getBoundingClientRect();
      const selected = track.querySelector('.selected').getBoundingClientRect();
      const visible = [...track.querySelectorAll('.spell-card')].find(card => {
        const rect = card.getBoundingClientRect();
        return rect.left >= bounds.left && rect.right <= bounds.right;
      });
      return { selectedOffscreen: selected.right <= bounds.left, scrollLeft: track.scrollLeft, id: visible.dataset.spellId };
    });
    assert.equal(fullBrowse.selectedOffscreen, true);
    await page.locator(`.spell-card[data-spell-id="${fullBrowse.id}"]`).hover();
    // Wait for the border hover animation that previously caused snap-back.
    await page.waitForTimeout(260);
    assert.ok(await page.locator('.car-track').evaluate(track => track.scrollLeft) >= fullBrowse.scrollLeft - 2);
    assert.deepEqual(await page.locator('.dock-details').evaluate(element => ({ html: element.innerHTML, scrollTop: element.querySelector('.preview-body').scrollTop })), fullContext);
    assert.equal(await page.evaluate(() => document.querySelector('.dock-details [data-panel="costs"]') === contextBeforeBrowse), true);
    assert.equal(await page.locator('.dock-details [data-tab="costs"]').getAttribute('aria-selected'), 'true');
    await page.locator('[data-action="left"]').click();
    assert.equal(await page.locator('.spell-card.selected').getAttribute('data-spell-id'), 'spell0');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator('input[type="search"]').fill("nie ma wyników");
    await page.waitForFunction(() => document.querySelectorAll(".spell-card").length === 0);
    await page.locator('[data-action="clear"]').click();
    await page.waitForFunction(() => document.querySelectorAll(".spell-card").length === 8);
    await page.locator('[data-action="toggle"]').click();
    assert.equal(await page.locator(".dock-details").isVisible(), false);
    assert.equal(await page.locator(".caster-info").isVisible(), false);
    assert.equal(await page.locator('input[type="search"]').isVisible(), false);
    assert.equal(await page.locator('.dock-header button:visible').count(), 1);
    assert.equal(await page.locator('[data-action="toggle"]').isVisible(), true);
    const compactToggle = await page.locator('[data-action="toggle"]').boundingBox();
    const compactDock = await page.locator('#coc7-spell-dock').boundingBox();
    const compactCarousel = await page.locator('.dock-carousel').boundingBox();
    assert.ok(Math.abs(compactToggle.x - compactDock.x) < 1);
    assert.ok(compactToggle.y + compactToggle.height <= compactCarousel.y);
    assert.equal(await page.locator('.dock-carousel').evaluate(element => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)");
    const compactArrow = await page.locator('[data-action="right"]').boundingBox();
    const compactRegularCard = await page.locator('.spell-card:not(.selected)').first().boundingBox();
    assert.ok(Math.abs(compactArrow.height - compactRegularCard.height) < 1);
    await page.screenshot({ path: path.join(root, ".local/compact-v033.png") });
    await page.locator('.spell-card[data-spell-id="spell2"]').hover();
    await page.waitForSelector(".spell-flyout.is-tooltip:visible");
    assert.equal(await page.locator(".tooltip-header .spell-title").innerText(), "Szept otchłani");
    assert.match(await page.locator(".tooltip-meta").innerText(), /2 godziny/);
    assert.equal(await page.locator(".tooltip-costs .cost-step").count(), 4);
    assert.match(await page.locator(".tooltip-description").innerText(), /Starożytny rytuał/);
    assert.equal(await page.locator(".spell-flyout [data-tab]").count(), 0);
    assert.equal(await page.evaluate(() => nativeCalls.length), 1);
    await page.locator(".tooltip-header").hover();
    assert.equal(await page.locator(".spell-flyout").isVisible(), true);
    const tooltipBounds = await page.locator(".spell-flyout").boundingBox();
    const compactBounds = await page.locator("#coc7-spell-dock").boundingBox();
    assert.ok(tooltipBounds.y + tooltipBounds.height < compactBounds.y);
    await page.locator(".tooltip-body").evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.locator(".tooltip-description").hover();
    assert.equal(await page.locator(".spell-flyout").isVisible(), true);
    await page.screenshot({ path: path.join(root, ".local/tooltip-v030.png") });
    await page.mouse.move(20, 20);
    await page.waitForSelector(".spell-flyout", { state: "hidden" });
    await page.locator('[data-action="right"]').click();
    await page.waitForFunction(() => document.querySelector('.car-track').scrollLeft > 10);
    assert.equal(await page.locator('.spell-card.selected').count(), 0);
    await page.locator('[data-action="left"]').click();
    await page.waitForFunction(() => document.querySelector('.car-track').scrollLeft < 1);
    const before = await page.locator(".dock-carousel").boundingBox();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.locator('.spell-card[data-spell-id="spell0"]').click();
    assert.equal(await page.evaluate(() => nativeCalls.length), 1);
    await page.waitForFunction(() => {
      const selected = document.querySelector(".spell-card.selected").getBoundingClientRect();
      const regular = document.querySelector(".spell-card:not(.selected)").getBoundingClientRect();
      return selected.width >= regular.width * 1.35;
    });
    const after = await page.locator(".dock-carousel").boundingBox();
    assert.ok(after.height > before.height);
    assert.equal(await page.locator(".dock-carousel").evaluate(element => getComputedStyle(element).transitionDuration), "0.2s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator('.spell-card[data-spell-id="spell0"]').click({ button: "right" });
    await page.waitForSelector(".spell-flyout:visible");
    assert.equal(await page.locator('.spell-flyout .tooltip-description').count(), 1);
    assert.equal(await page.locator(".spell-flyout .cost-step").count(), 4);
    const fly = await page.locator(".spell-flyout").boundingBox();
    assert.ok(fly.x >= 0 && fly.x + fly.width <= 1440);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".spell-flyout").isVisible(), false);
    await page.locator('.spell-card[data-spell-id="spell0"]').click();
    await page.waitForFunction(() => nativeCalls.length === 2);
    assert.deepEqual(await page.evaluate(() => nativeCalls[1]), { id: "spell0", hidden: true });
    await page.locator('.spell-card[data-spell-id="spell0"]').click();
    assert.equal(await page.evaluate(() => nativeCalls.length), 2);
    await page.locator('.spell-card[data-spell-id="spell3"]').dblclick();
    await page.waitForFunction(() => nativeCalls.length === 3);
    assert.deepEqual(await page.evaluate(() => nativeCalls[2]), { id: "spell3", hidden: true });
    await page.locator('[data-action="toggle"]').click();
    assert.equal(await page.locator('input[type="search"]').isVisible(), true);
    await page.waitForSelector('.dock-details [data-panel="description"]:visible');
    await page.locator('.dock-details [data-tab="description"]').click();
    await page.locator(".dock-details .inline-roll").click();
    assert.equal(await page.locator(".spell-card.selected").count(), 1);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator("#coc7-spell-dock").isVisible(), true);
    const mobile = await page.locator("#coc7-spell-dock").boundingBox();
    assert.ok(mobile.x >= 0 && mobile.x + mobile.width <= 390);
    assert.ok(mobile.y >= 0 && mobile.y + mobile.height <= 844);
    await page.screenshot({ path: path.join(root, ".local/mobile-v030.png") });
    await page.locator('[data-action="toggle"]').click();
    await page.locator('.spell-card.selected').hover();
    await page.waitForSelector(".spell-flyout.is-tooltip:visible");
    const mobileTooltip = await page.locator(".spell-flyout").boundingBox();
    assert.ok(mobileTooltip.x >= 0 && mobileTooltip.x + mobileTooltip.width <= 390);
    assert.ok(mobileTooltip.y >= 0 && mobileTooltip.y + mobileTooltip.height <= 844);
    await page.keyboard.press("Escape");
    // Regression: navigation clears selection, and hover must not snap back.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.locator('.spell-card[data-spell-id="spell0"]').click();
    const castsBeforeBrowse = await page.evaluate(() => nativeCalls.length);
    await page.locator('[data-action="right"]').click();
    await page.waitForFunction(() => document.querySelector('.car-track').scrollLeft > 100);
    assert.equal(await page.locator('.spell-card.selected').count(), 0);
    assert.equal(await page.locator('.spell-card[aria-pressed="true"]').count(), 0);
    await page.waitForFunction(() => game.user.getFlag('cthulhu-spell-reader', 'coc7SpellDockStateV1').spellId === null);
    const browsedCard = await page.locator('.car-track').evaluate(track => {
      const bounds = track.getBoundingClientRect();
      return [...track.querySelectorAll('.spell-card')].find(card => {
        const rect = card.getBoundingClientRect();
        return rect.left >= bounds.left && rect.right <= bounds.right;
      }).dataset.spellId;
    });
    const browsedPosition = await page.locator('.car-track').evaluate(track => track.scrollLeft);
    await page.locator(`.spell-card[data-spell-id="${browsedCard}"]`).hover();
    await page.waitForSelector('.spell-flyout.is-tooltip:visible');
    assert.ok(await page.locator('.car-track').evaluate(track => track.scrollLeft) >= browsedPosition - 2);
    await page.keyboard.press('Escape');
    await page.locator(`.spell-card[data-spell-id="${browsedCard}"]`).click();
    assert.equal(await page.evaluate(() => nativeCalls.length), castsBeforeBrowse);
    await page.locator('[data-action="left"]').click();
    assert.equal(await page.locator('.spell-card.selected').count(), 0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (let i = 0; i < 3; i++) {
      await page.evaluate(async () => {
        dockModule.closeDock();
        for (const callbacks of Hooks.events.values()) if (callbacks.size) throw Error("Leaked hook");
        await dockModule.openDock({ casterActor: actor });
        for (const callbacks of Hooks.events.values()) if (callbacks.size !== 1) throw Error("Duplicated hook");
        if (Hooks.events.has("targetToken")) throw Error("Target handling should be removed");
      });
    }
    const macroSource = await fs.readFile(path.join(root, "macros/toggle-spell-reader.js"), "utf8");
    const macroResults = await page.evaluate(async source => {
      dockModule.closeDock();
      const onceCallbacks = new Map();
      Hooks.once = (name, callback) => onceCallbacks.set(name, callback);
      game.system = { id: "CoC7" };
      game.keybindings = { register() {} };
      game.modules = new Map([["cthulhu-spell-reader", { active: true }]]);
      window.canvas = { ready: true, tokens: { controlled: [{ actor }] } };
      await import("/scripts/main.js");
      onceCallbacks.get("init")();
      onceCallbacks.get("ready")();
      const controls = { tokens: { tools: {} } };
      for (const callback of Hooks.events.get("getSceneControlButtons")) callback(controls);
      ui.controls = { controls };
      const run = new (Object.getPrototypeOf(async function () {}).constructor)(source);
      await run();
      const apiOpened = dockModule.isDockOpen();
      await run();
      const apiClosed = !dockModule.isDockOpen();
      delete game.modules.get("cthulhu-spell-reader").api;
      await run();
      const toolOpened = dockModule.isDockOpen();
      await run();
      const toolClosed = !dockModule.isDockOpen();
      return { apiOpened, apiClosed, toolOpened, toolClosed };
    }, macroSource);
    assert.deepEqual(macroResults, { apiOpened: true, apiClosed: true, toolOpened: true, toolClosed: true });
    assert.deepEqual(errors, []);
    console.log("PASS: compact top-left toggle, card-height arrows, expanded gray carousel/preserved context/no snap-back, tooltips, casting, mobile, lifecycle and hotbar macro");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
