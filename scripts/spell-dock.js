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
    flyVersion++;
    flySpellId = null;
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
    dock.querySelector('[data-action="toggle"]').setAttribute("aria-expanded", String(state.expanded));
    const hotbarHeight = document.getElementById("hotbar")?.offsetHeight ?? 0;
    dock.style.setProperty("--dock-bottom", `${hotbarHeight ? hotbarHeight + 18 : 88}px`);
    updateArrows();
  }

  function updateArrows() {
    dock.querySelector('[data-action="left"]').disabled = track.scrollLeft <= 2;
    dock.querySelector('[data-action="right"]').disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
  }

  function revealSelection() {
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

  async function previewHTML(spell, prefix) {
    const [description, costs] = await Promise.all([
      foundry.applications.ux.TextEditor.implementation.enrichHTML(
        spell.system?.description?.value || "<i>Brak opisu.</i>",
        { secrets: false, rolls: true, documents: true, links: true, relativeTo: spell, rollData: casterActor.getRollData?.() }
      ),
      renderTemplate("spell-costs", getSpellCosts(spell))
    ]);
    return renderTemplate("spell-preview", {
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
        title="${escapeHtml(spell.name)}">
        <img src="${escapeHtml(spell.img || "icons/svg/book.svg")}" alt="" draggable="false">
        <span class="spell-name">${escapeHtml(spell.name)}</span>
      </button>`).join("");
    dock.classList.toggle("has-selection", !!state.spellId);
    dock.querySelector(".empty-spells").hidden = spells.length > 0;
    updateArrows();
  }

  async function selectSpell(id) {
    state.spellId = id;
    closeFlyout();
    track.querySelectorAll(".spell-card").forEach(card => {
      const selected = card.dataset.spellId === id;
      card.classList.toggle("selected", selected);
      card.setAttribute("aria-pressed", String(selected));
    });
    dock.classList.toggle("has-selection", !!id);
    await Promise.all([renderPreview(), saveState()]);
    if (!disposed) revealSelection();
  }

  async function openFlyout(id, card) {
    if (!flyout.hidden && flySpellId === id) return closeFlyout();
    const spell = selectedSpell(id);
    if (!spell) return;
    const version = ++flyVersion;
    flySpellId = id;
    flyPreview.dataset.spellId = id;
    try {
      const html = await previewHTML(spell, `${DOCK_ID}-fly`);
      if (disposed || version !== flyVersion) return;
      flyPreview.innerHTML = html;
      flyout.hidden = false;
      syncCastButtons();
      const rect = card.getBoundingClientRect();
      const width = flyout.offsetWidth;
      const height = flyout.offsetHeight;
      flyout.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      flyout.style.top = `${Math.max(12, Math.min(rect.top - height - 10, window.innerHeight - height - 12))}px`;
    } catch (error) {
      if (version === flyVersion) closeFlyout();
      console.error("Cthulhu Spell Reader | Podgląd PPM", error);
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
    if (button.dataset.spellId) return selectSpell(button.dataset.spellId);
    if (button.dataset.tab) return changeTab(button);
    switch (button.dataset.action) {
      case "close": closeDock(); break;
      case "close-flyout": closeFlyout(); break;
      case "toggle":
        state.expanded = !state.expanded;
        closeFlyout();
        renderCarousel();
        updateLayout();
        await Promise.all([renderPreview(), saveState()]);
        break;
      case "clear":
        clearTimeout(searchTimer);
        search.value = state.search = "";
        closeFlyout();
        renderCarousel();
        await Promise.all([renderPreview(), saveState()]);
        break;
      case "left": case "right":
        track.scrollBy({ left: track.clientWidth * 0.8 * (button.dataset.action === "left" ? -1 : 1), behavior: "smooth" });
        break;
      case "cast": {
        if (casting) break;
        const id = button.closest("[data-spell-id]")?.dataset.spellId;
        const spell = selectedSpell(id);
        if (!spell) break;
        casting = true;
        syncCastButtons();
        try { await castSpell(spell); }
        finally {
          casting = false;
          if (!disposed) { updateStats(); syncCastButtons(); }
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
    void openFlyout(card.dataset.spellId, card);
  }, { signal });
  track.addEventListener("wheel", event => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || track.scrollWidth <= track.clientWidth) return;
    event.preventDefault();
    track.scrollLeft += event.deltaY;
  }, { passive: false, signal });
  track.addEventListener("scroll", updateArrows, { passive: true, signal });
  track.addEventListener("transitionend", () => { revealSelection(); updateArrows(); }, { signal });
  search.addEventListener("input", () => {
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
