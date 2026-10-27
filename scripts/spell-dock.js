import { MODULE_ID, DOCK_ID, DOCK_STATE_FLAG, DEFAULT_EXPANDED } from "./config.js";
import { escapeHtml, asIntFloor } from "./utils.js";
import { getHP, getMP, getSAN, getPOW } from "./actor.js";
import { getSpellCoCID, getSpellTypesString } from "./spells.js";
import { getSpellCosts, localize } from "./costs.js";
import { castSpell } from "./casting.js";

const templatePath = name => `modules/${MODULE_ID}/templates/${name}.hbs`;
const renderTemplate = (name, data) => foundry.applications.handlebars.renderTemplate(templatePath(name), data);
let activeDock = null;
let generation = 0;

export function closeDock() {
  generation++;
  const current = activeDock;
  activeDock = null;
  current?.close();
}

export function isDockOpen() {
  return !!activeDock?.element.isConnected;
}

export async function openDock({ casterActor }) {
  closeDock();
  const openingGeneration = generation;
  const shell = await renderTemplate("spell-dock", { casterName: casterActor.name ?? "—", isGM: game.user.isGM });
  if (openingGeneration !== generation) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = shell;
  const dock = wrapper.firstElementChild;
  document.body.appendChild(dock);

  const saved = game.user.getFlag(MODULE_ID, DOCK_STATE_FLAG)
    ?? game.user.getFlag("world", DOCK_STATE_FLAG) ?? {};
  const state = {
    expanded: saved.expanded ?? DEFAULT_EXPANDED,
    spellId: saved.spellId ?? null,
    search: saved.search ?? ""
  };
  const controller = new AbortController();
  const { signal } = controller;
  const track = dock.querySelector(".car-track");
  const search = dock.querySelector("input[type=search]");
  const preview = dock.querySelector(".dock-details");
  const flyout = dock.querySelector(".spell-flyout");
  const flyPreview = dock.querySelector(".fly-preview");
  const hooks = [];
  let saveQueue = Promise.resolve();
  let searchTimer;
  let previewVersion = 0;
  let flyVersion = 0;
  let flySpellId = null;
  let flyPinned = false;
  let tooltipTimer;
  let tooltipHideTimer;
  let clickedSpellId = null;
  let autoRevealSelection = false;
  let casting = false;
  let disposed = false;

  function saveState() {
    // Only current UI preferences are saved; obsolete target/variable flags disappear.
    const snapshot = { ...state };
    saveQueue = saveQueue.then(() => game.user.setFlag(MODULE_ID, DOCK_STATE_FLAG, snapshot))
      .catch(error => console.warn("Cthulhu Spell Reader | Nie udało się zapisać ustawień panelu", error));
    return saveQueue;
  }

  function closeFlyout() {
    clearTimeout(tooltipTimer);
    clearTimeout(tooltipHideTimer);
    flyVersion++;
    flySpellId = null;
    flyPinned = false;
    track.querySelectorAll("[aria-describedby]").forEach(card => card.removeAttribute("aria-describedby"));
    flyout.hidden = true;
  }

  activeDock = {
    element: dock,
    close() {
      disposed = true;
      previewVersion++;
      closeFlyout();
      clearTimeout(searchTimer);
      controller.abort();
      for (const [name, callback] of hooks) Hooks.off(name, callback);
      void saveState();
      dock.remove();
    }
  };

  function allSpells() {
    return casterActor.items.filter(item => item.type === "spell");
  }

  function selectedSpell(id = state.spellId) {
    return allSpells().find(item => item.id === id);
  }

  function updateStats() {
    dock.querySelector(".caster-name").textContent = casterActor.name ?? "—";
    dock.querySelector(".stats").textContent = `HP ${asIntFloor(getHP(casterActor))} | MP ${asIntFloor(getMP(casterActor))} | SAN ${asIntFloor(getSAN(casterActor))} | POW ${asIntFloor(getPOW(casterActor))}`;
  }

  function updateLayout() {
    dock.classList.toggle("collapsed", !state.expanded);
    preview.hidden = !state.expanded;
    const toggle = dock.querySelector('[data-action="toggle"]');
    toggle.setAttribute("aria-expanded", String(state.expanded));
    toggle.setAttribute("aria-label", state.expanded ? "Zwiń panel zaklęć" : "Rozwiń panel zaklęć");
    toggle.title = state.expanded ? "Zwiń panel zaklęć" : "Rozwiń panel zaklęć";
    const hotbarHeight = document.getElementById("hotbar")?.offsetHeight ?? 0;
    dock.style.setProperty("--dock-bottom", `${hotbarHeight ? hotbarHeight + 18 : 88}px`);
    updateArrows();
  }

  function updateArrows() {
    dock.querySelector('[data-action="left"]').disabled = track.scrollLeft <= 2;
    dock.querySelector('[data-action="right"]').disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
  }

  function revealSelection() {
    if (!autoRevealSelection) return;
    const card = track.querySelector(".spell-card.selected");
    if (!card) return;
    const bounds = track.getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    const delta = rect.left < bounds.left ? rect.left - bounds.left : Math.max(0, rect.right - bounds.right);
    if (Math.abs(delta) > 1) track.scrollBy({ left: delta, behavior: "smooth" });
  }

  function syncCastButtons() {
    dock.querySelectorAll('[data-action="cast"]').forEach(button => {
      button.disabled = casting || !casterActor.isOwner;
      button.setAttribute("aria-busy", String(casting));
    });
  }

  async function previewHTML(spell, prefix, tooltip = false) {
    const [description, costs] = await Promise.all([
      foundry.applications.ux.TextEditor.implementation.enrichHTML(
        spell.system?.description?.value || "<i>Brak opisu.</i>",
        { secrets: false, rolls: true, documents: true, links: true, relativeTo: spell, rollData: casterActor.getRollData?.() }
      ),
      renderTemplate("spell-costs", getSpellCosts(spell))
    ]);
    return renderTemplate(tooltip ? "spell-tooltip" : "spell-preview", {
      prefix,
      name: spell.name ?? "—",
      cocid: getSpellCoCID(spell) ?? "—",
      castingTime: spell.system?.castingTime || "—",
      types: getSpellTypesString(spell),
      castLabel: localize("CoC7.CastTesting", "Test Cast"),
      description,
      costs
    });
  }

  async function renderPreview() {
    const version = ++previewVersion;
    const spell = selectedSpell();
    preview.dataset.spellId = spell?.id ?? "";
    preview.innerHTML = spell ? '<p class="muted">Ładuję opis…</p>' : '<p class="muted">Wybierz zaklęcie.</p>';
    if (!spell) return;
    try {
      const html = await previewHTML(spell, `${DOCK_ID}-main`);
      if (disposed || version !== previewVersion) return;
      preview.innerHTML = html;
      syncCastButtons();
    } catch (error) {
      if (disposed || version !== previewVersion) return;
      preview.innerHTML = '<p class="muted">Nie udało się wczytać podglądu zaklęcia.</p>';
      console.error("Cthulhu Spell Reader | Podgląd zaklęcia", error);
    }
  }

  function renderCarousel() {
    const query = state.search.toLocaleLowerCase().trim();
    const spells = allSpells().filter(spell => !query || `${spell.name} ${getSpellTypesString(spell)}`.toLocaleLowerCase().includes(query));
    if (!spells.some(spell => spell.id === state.spellId)) state.spellId = state.expanded ? spells[0]?.id ?? null : null;
    track.innerHTML = spells.map(spell => `
      <button type="button" class="spell-card${spell.id === state.spellId ? " selected" : ""}"
        data-spell-id="${escapeHtml(spell.id)}" aria-pressed="${spell.id === state.spellId}"
        aria-label="${escapeHtml(spell.name)}">
        <img src="${escapeHtml(spell.img || "icons/svg/book.svg")}" alt="" draggable="false">
        <span class="spell-name">${escapeHtml(spell.name)}</span>
      </button>`).join("");
    dock.classList.toggle("has-selection", !!state.spellId);
    dock.querySelector(".empty-spells").hidden = spells.length > 0;
    updateArrows();
  }

  async function selectSpell(id) {
    autoRevealSelection = !!id;
    state.spellId = id;
    closeFlyout();
    track.querySelectorAll(".spell-card").forEach(card => {
      const selected = card.dataset.spellId === id;
      card.classList.toggle("selected", selected);
      card.setAttribute("aria-pressed", String(selected));
    });
    dock.classList.toggle("has-selection", !!id);
    await Promise.all([renderPreview(), saveState()]);
    if (!disposed && state.spellId === id) revealSelection();
  }

  async function openFlyout(id, card, { pinned = false } = {}) {
    clearTimeout(tooltipTimer);
    clearTimeout(tooltipHideTimer);
    if (!flyout.hidden && flySpellId === id) {
      if (pinned && flyPinned) return closeFlyout();
      flyPinned ||= pinned;
      return;
    }
    const spell = selectedSpell(id);
    if (!spell) return;
    const version = ++flyVersion;
    flySpellId = id;
    flyPinned = pinned;
    flyPreview.dataset.spellId = id;
    flyout.classList.toggle("is-tooltip", !state.expanded);
    try {
      const html = await previewHTML(spell, `${DOCK_ID}-fly`, !state.expanded);
      if (disposed || version !== flyVersion || !card.isConnected) return;
      flyPreview.innerHTML = html;
      flyout.hidden = false;
      track.querySelectorAll("[aria-describedby]").forEach(item => item.removeAttribute("aria-describedby"));
      card.setAttribute("aria-describedby", flyout.id);
      syncCastButtons();
      const rect = card.getBoundingClientRect();
      const anchorTop = state.expanded ? rect.top : dock.getBoundingClientRect().top;
      flyout.style.maxHeight = state.expanded ? "" : `${Math.min(580, Math.max(140, anchorTop - 24))}px`;
      const width = flyout.offsetWidth;
      const height = flyout.offsetHeight;
      flyout.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      flyout.style.top = `${Math.max(12, Math.min(anchorTop - height - 10, window.innerHeight - height - 12))}px`;
    } catch (error) {
      if (version === flyVersion) closeFlyout();
      console.error("Cthulhu Spell Reader | Podgląd PPM", error);
    }
  }

  function scheduleTooltip(card, delay = 240) {
    if (state.expanded || flyPinned || casting) return;
    clearTimeout(tooltipHideTimer);
    clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(() => {
      if (!disposed && card.isConnected) void openFlyout(card.dataset.spellId, card);
    }, delay);
  }

  function scheduleTooltipClose() {
    clearTimeout(tooltipTimer);
    if (flyPinned) return;
    clearTimeout(tooltipHideTimer);
    tooltipHideTimer = setTimeout(closeFlyout, 180);
  }

  async function runCast(spell) {
    if (casting || !spell) return;
    clickedSpellId = null;
    closeFlyout();
    casting = true;
    syncCastButtons();
    try { await castSpell(spell); }
    finally {
      casting = false;
      if (!disposed) { updateStats(); syncCastButtons(); }
    }
  }

  function changeTab(button) {
    const host = button.closest(".dock-details, .fly-preview");
    const tab = button.dataset.tab;
    host.querySelectorAll('[role="tab"]').forEach(item => {
      const active = item.dataset.tab === tab;
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
    });
    host.querySelectorAll('[role="tabpanel"]').forEach(panel => { panel.hidden = panel.dataset.panel !== tab; });
  }

  dock.addEventListener("click", async event => {
    const button = event.target.closest("button");
    if (!button || !dock.contains(button)) return;
    if (button.dataset.spellId) {
      const id = button.dataset.spellId;
      if (!state.expanded && clickedSpellId === id && state.spellId === id) return runCast(selectedSpell(id));
      clickedSpellId = state.expanded ? null : id;
      await selectSpell(id);
      if (!disposed && !state.expanded && state.spellId === id && !casting) scheduleTooltip(button, 0);
      return;
    }
    if (button.dataset.tab) return changeTab(button);
    switch (button.dataset.action) {
      case "close": closeDock(); break;
      case "close-flyout": closeFlyout(); break;
      case "toggle":
        clickedSpellId = null;
        state.expanded = !state.expanded;
        closeFlyout();
        renderCarousel();
        updateLayout();
        await Promise.all([renderPreview(), saveState()]);
        break;
      case "clear":
        clickedSpellId = null;
        clearTimeout(searchTimer);
        search.value = state.search = "";
        closeFlyout();
        renderCarousel();
        await Promise.all([renderPreview(), saveState()]);
        break;
      case "left": case "right":
        clickedSpellId = null;
        autoRevealSelection = false;
        closeFlyout();
        // Full view keeps its selected spell, current tab and preview scroll.
        if (!state.expanded) void selectSpell(null);
        track.scrollBy({ left: track.clientWidth * 0.8 * (button.dataset.action === "left" ? -1 : 1), behavior: "smooth" });
        break;
      case "cast": {
        const id = button.closest("[data-spell-id]")?.dataset.spellId;
        await runCast(selectedSpell(id));
        break;
      }
      case "open-item": {
        const id = button.closest("[data-spell-id]")?.dataset.spellId;
        const spell = selectedSpell(id);
        if (!spell?.sheet) break;
        closeFlyout();
        try { await spell.sheet.render({ force: true }); }
        catch (error) {
          console.error("Cthulhu Spell Reader | Karta przedmiotu", error);
          ui.notifications.error("Nie udało się otworzyć karty zaklęcia.");
        }
        break;
      }
    }
  }, { signal });

  track.addEventListener("contextmenu", event => {
    const card = event.target.closest(".spell-card");
    if (!card) return;
    event.preventDefault();
    event.stopPropagation();
    void openFlyout(card.dataset.spellId, card, { pinned: true });
  }, { signal });
  track.addEventListener("pointerover", event => {
    const card = event.target.closest(".spell-card");
    if (card && !card.contains(event.relatedTarget)) scheduleTooltip(card);
  }, { signal });
  track.addEventListener("pointerout", event => {
    const card = event.target.closest(".spell-card");
    if (card && !card.contains(event.relatedTarget)) scheduleTooltipClose();
  }, { signal });
  track.addEventListener("focusin", event => {
    const card = event.target.closest(".spell-card");
    if (card) scheduleTooltip(card, 0);
  }, { signal });
  track.addEventListener("focusout", event => {
    if (!flyout.contains(event.relatedTarget)) scheduleTooltipClose();
  }, { signal });
  flyout.addEventListener("pointerenter", () => clearTimeout(tooltipHideTimer), { signal });
  flyout.addEventListener("pointerleave", scheduleTooltipClose, { signal });
  flyout.addEventListener("focusin", () => clearTimeout(tooltipHideTimer), { signal });
  flyout.addEventListener("focusout", event => {
    if (!flyout.contains(event.relatedTarget)) scheduleTooltipClose();
  }, { signal });
  track.addEventListener("wheel", event => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || track.scrollWidth <= track.clientWidth) return;
    event.preventDefault();
    autoRevealSelection = false;
    track.scrollLeft += event.deltaY;
  }, { passive: false, signal });
  track.addEventListener("scroll", () => {
    closeFlyout();
    updateArrows();
    const card = track.querySelector(".spell-card:hover, .spell-card:focus-visible");
    if (card) scheduleTooltip(card, 180);
  }, { passive: true, signal });
  track.addEventListener("transitionend", event => {
    // Hover changes border-color too; it must never move the carousel.
    if (event.target.matches(".spell-card.selected") && ["width", "height", "flex-basis"].includes(event.propertyName)) revealSelection();
    updateArrows();
  }, { signal });
  search.addEventListener("input", () => {
    clickedSpellId = null;
    state.search = search.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      closeFlyout();
      renderCarousel();
      void renderPreview();
      void saveState();
    }, 100);
  }, { signal });
  dock.addEventListener("keydown", event => {
    const tab = event.target.closest('[role="tab"]');
    if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]')];
    const next = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs.at(-1) : tabs[(tabs.indexOf(tab) + 1) % tabs.length];
    changeTab(next);
    next.focus();
  }, { signal });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !flyout.hidden) { event.stopPropagation(); closeFlyout(); }
  }, { capture: true, signal });
  document.addEventListener("pointerdown", event => {
    if (!flyout.hidden && !flyout.contains(event.target) && !event.target.closest(`#${DOCK_ID} .spell-card`)) closeFlyout();
  }, { capture: true, signal });
  window.addEventListener("resize", () => { closeFlyout(); updateLayout(); }, { signal });

  const matchesActor = actor => actor === casterActor || actor?.uuid === casterActor.uuid;
  function hook(name, callback) { Hooks.on(name, callback); hooks.push([name, callback]); }
  hook("updateActor", actor => { if (matchesActor(actor)) updateStats(); });
  for (const name of ["createItem", "updateItem", "deleteItem"]) {
    hook(name, item => {
      if (!matchesActor(item.parent)) return;
      clickedSpellId = null;
      closeFlyout();
      renderCarousel();
      void renderPreview();
      void saveState();
    });
  }

  search.value = state.search;
  updateStats();
  renderCarousel();
  updateLayout();
  await Promise.all([renderPreview(), saveState()]);
}
