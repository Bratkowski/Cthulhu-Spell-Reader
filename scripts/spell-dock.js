import { MODULE_ID, DOCK_ID, DOCK_STATE_FLAG, DEFAULT_EXPANDED, DOCK_COLLAPSED_H, DOCK_EXPANDED_H, CAROUSEL_H_COLLAPSED, CAROUSEL_H_EXPANDED } from "./config.js";
import { escapeHtml, asIntFloor } from "./utils.js";
import { getHP, getMP, getSAN, getPOW, getFirstTargetToken } from "./actor.js";
import { getSpellCoCID, getSpellTargetInfo } from "./target-dictionary.js";
import { getSpellTypesString } from "./spells.js";
import { costNeedsVariable } from "./costs.js";
import { castSpellCore } from "./casting.js";

let dockCleanup = null;

export function closeDock() {
  dockCleanup?.();
  document.getElementById(DOCK_ID)?.remove();
}

export function isDockOpen() {
  return !!document.getElementById(DOCK_ID);
}

function hotbarOffsetPx() {
  const h = document.getElementById("hotbar")?.offsetHeight ?? 0;
  return h ? h + 18 : 88;
}

export async function openDock({ casterToken, casterActor }) {
  closeDock();

  const wrap = document.createElement("div");
  wrap.innerHTML = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/spell-dock.hbs`,
    { casterName: casterActor.name ?? "—", isGM: game.user.isGM }
  );
  document.body.appendChild(wrap.firstElementChild);

  const dock = document.getElementById(DOCK_ID);

  // restore state
  const saved = game.user.getFlag(MODULE_ID, DOCK_STATE_FLAG)
    ?? game.user.getFlag("world", DOCK_STATE_FLAG) ?? {};
  const expanded = (saved.expanded ?? DEFAULT_EXPANDED) === true;
  if (!expanded) dock.classList.add("collapsed");
  // restore extra state
let manualHasTarget = (saved.manualHasTarget ?? true) === true;
let variableValue   = asIntFloor(saved.variableValue ?? 0);

  function applyHeights() {
  const isCollapsed = dock.classList.contains("collapsed");
  dock.style.height = `${isCollapsed ? DOCK_COLLAPSED_H : DOCK_EXPANDED_H}px`;

  const car = dock.querySelector(".dock-carousel");
  if (car) car.style.height = `${isCollapsed ? CAROUSEL_H_COLLAPSED : CAROUSEL_H_EXPANDED}px`;

  dock.style.bottom = `${hotbarOffsetPx()}px`;
}
  applyHeights();

  let searchT;

  // elements
  const $track = dock.querySelector(`#${DOCK_ID}-track`);
  const $left = dock.querySelector(`#${DOCK_ID}-left`);
  const $right = dock.querySelector(`#${DOCK_ID}-right`);
  const $search = dock.querySelector(`#${DOCK_ID}-search`);
  const $clear = dock.querySelector(`#${DOCK_ID}-clear`);
  const $toggle = dock.querySelector(`#${DOCK_ID}-toggle`);
  const $close = dock.querySelector(`#${DOCK_ID}-close`);
  const $stats = dock.querySelector(`#${DOCK_ID}-stats`);

  const $spellTitle = dock.querySelector(`#${DOCK_ID}-spellTitle`);
  const $spellMeta = dock.querySelector(`#${DOCK_ID}-spellMeta`);
  const $costs = dock.querySelector(`#${DOCK_ID}-costs`);
  const $desc = dock.querySelector(`#${DOCK_ID}-desc`);
  const $cast = dock.querySelector(`#${DOCK_ID}-cast`);
  const $castHint = dock.querySelector(`#${DOCK_ID}-castHint`);

  // ===== Flyout =====
  const $fly = dock.querySelector(`#${DOCK_ID}-flyout`);
  const $flyTitle = dock.querySelector(`#${DOCK_ID}-flyTitle`);
  const $flyMeta  = dock.querySelector(`#${DOCK_ID}-flyMeta`);
  const $flyGrid  = dock.querySelector(`#${DOCK_ID}-flyGrid`);
  const $flyDesc  = dock.querySelector(`#${DOCK_ID}-flyDesc`);
  const $flyClose = dock.querySelector(`#${DOCK_ID}-flyClose`);

  let flyOpenForSpellId = null;

  function closeFlyout() {
    flyOpenForSpellId = null;
    $fly?.classList.remove("open");
  }

  $flyClose?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeFlyout();
  });

  // zamykanie klik poza + ESC
function onDocMouseDown(e) {
  if (!$fly?.classList.contains("open")) return;
  const insideFly  = e.target.closest?.(`#${DOCK_ID}-flyout`);
  const insideCard = e.target.closest?.(`#${DOCK_ID} .spell-card`);
  const insideDock = e.target.closest?.(`#${DOCK_ID}`);
  if (!insideFly && !insideCard && !insideDock) closeFlyout();
}
  function onDocKeyDown(e) {
    if (e.key === "Escape") closeFlyout();
  }
  document.addEventListener("mousedown", onDocMouseDown, true);
  document.addEventListener("keydown", onDocKeyDown, true);

  // Remove all listeners owned by this dock instance.
dockCleanup = () => {
  try { window.removeEventListener("resize", onResize); } catch (_) {}
  try { document.removeEventListener("mousedown", onDocMouseDown, true); } catch (_) {}
  try { document.removeEventListener("keydown", onDocKeyDown, true); } catch (_) {}
  try { Hooks.off("targetToken", onTargetChange); } catch (_) {}
  try { closeFlyout(); } catch (_) {}
  clearTimeout(searchT);
  dockCleanup = null;
};

  async function setEnriched(el, rawHtml) {
    const raw = rawHtml || "<i>Brak opisu.</i>";
    try {
      const enriched = await foundry.applications.ux.TextEditor.implementation.enrichHTML(raw, {
        async: true, secrets: false, documents: true, links: true, rolls: true
      });
      el.innerHTML = enriched;
      el.classList.add("cocspell-desc");
    } catch (e) {
      console.warn("enrichHTML failed", e);
      el.innerHTML = raw;
      el.classList.add("cocspell-desc");
    }
  }

  async function openFlyoutForCard(cardEl, sp, info) {
    if (!$fly || !$flyTitle || !$flyMeta || !$flyGrid || !$flyDesc) return;
    if (!dock.classList.contains("collapsed")) return;

    // toggle: PPM na tym samym sp -> zamyka
    if ($fly.classList.contains("open") && flyOpenForSpellId === sp.id) {
      closeFlyout();
      return;
    }
    flyOpenForSpellId = sp.id;

    $flyTitle.textContent = sp.name ?? "—";
    $flyMeta.textContent =
      `CoCID: ${getSpellCoCID(sp) ?? "—"} | Cast: ${sp.system?.castingTime ?? "—"}`;

    const costs = sp.system?.costs ?? {};
    $flyGrid.innerHTML = `
      <div>Typ</div><div>${escapeHtml(getSpellTypesString(sp))}</div>
      <div>Koszty</div><div>
        HP: ${escapeHtml(costs.hitPoints ?? "0")} |
        MP: ${escapeHtml(costs.magicPoints ?? "0")} |
        SAN: ${escapeHtml(costs.sanity ?? "0")} |
        POW: ${escapeHtml(costs.power ?? "0")}
      </div>
      <div>Cel</div><div>${info.locked ? (info.hasTarget ? "✅ ma cel (słownik)" : "🚫 brak celu (słownik)") : "manual"}</div>
      <div>Key</div><div><code>${escapeHtml(info.key ?? "—")}</code></div>
      <div>Tip</div><div>PPM na karcie ponownie zamyka flyout</div>
    `;

    await setEnriched($flyDesc, sp.system?.description?.value ?? "<i>Brak opisu.</i>");

    // show first to measure size
    $fly.classList.add("open");

    const rect = cardEl.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();
    const flyW = $fly.offsetWidth;
    const flyH = $fly.offsetHeight;
    const gap = 10;

    // prefer right
    let left = rect.right + gap;
    let top  = rect.top;

    // flip left if no space
    if (left + flyW > dockRect.right - 10) left = rect.left - gap - flyW;

    // clamp to dock area
    left = Math.max(dockRect.left + 10, Math.min(left, dockRect.right - flyW - 10));
    top  = Math.max(dockRect.top + 60, Math.min(top, dockRect.bottom - flyH - 10));

    $fly.style.left = `${left}px`;
    $fly.style.top  = `${top}px`;
  }

  // spell list
  const allSpells = casterActor.items.filter(i => i.type === "spell");
  if (!allSpells.length) ui.notifications.warn("Ten aktor nie ma żadnych zaklęć (Items typu 'spell').");

  const spellById = new Map(allSpells.map(s => [s.id, s]));

// Jeśli dock startuje w collapsed, NIE wybieraj nic domyślnie.
const startCollapsed = dock.classList.contains("collapsed");

let currentSpellId =
  (!startCollapsed && saved.spellId && spellById.has(saved.spellId))
    ? saved.spellId
    : (!startCollapsed ? (allSpells[0]?.id ?? null) : null);



  const lockedInfoCache = new Map(); // spellId -> {locked,hasTarget,key}
  async function getLockedInfo(spell) {
    const id = spell.id;
    if (lockedInfoCache.has(id)) return lockedInfoCache.get(id);
    const info = await getSpellTargetInfo(spell);
    lockedInfoCache.set(id, info);
    return info;
  }

  function resolveHasTargetForSpell(spell, tInfo) {
    return tInfo.locked ? !!tInfo.hasTarget : !!manualHasTarget;
  }

  function updateArrows() {
    const viewport = $track;
    const maxLeft = viewport.scrollWidth - viewport.clientWidth;
    const leftDisabled = viewport.scrollLeft <= 2;
    const rightDisabled = viewport.scrollLeft >= (maxLeft - 2);

    $left.classList.toggle("disabled", leftDisabled);
    $right.classList.toggle("disabled", rightDisabled);
  }

  function scrollByPage(dir) {
    const viewport = $track;
    const delta = viewport.clientWidth * 0.85 * dir;
    viewport.scrollBy({ left: delta, behavior: "smooth" });
  }

  $left.addEventListener("click", () => { if (!$left.classList.contains("disabled")) scrollByPage(-1); });
  $right.addEventListener("click", () => { if (!$right.classList.contains("disabled")) scrollByPage(1); });
  $track.addEventListener("scroll", () => updateArrows(), { passive: true });

  // wheel -> horizontal scroll
  $track.addEventListener("wheel", (e) => {
    if (e.target.closest(".side-body")) return;
    if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    e.preventDefault();
    $track.scrollLeft += e.deltaY;
    updateArrows();
  }, { passive: false });

  function updateCasterPanel() {
    $stats.textContent =
      `HP ${asIntFloor(getHP(casterActor))} | MP ${asIntFloor(getMP(casterActor))} | SAN ${asIntFloor(getSAN(casterActor))} | POW ${asIntFloor(getPOW(casterActor))}`;
  }

function onTargetChange() {
  void updateCastButtonState();
}
Hooks.on("targetToken", onTargetChange);

async function updateCastButtonState() {
  if (!currentSpellId) {
    $cast.disabled = true;
    $castHint.textContent = "Wybierz zaklęcie.";
    return;
  }


  const spell = spellById.get(currentSpellId);
  if (!spell) {
    $cast.disabled = true;
    $castHint.textContent = "Nie mogę znaleźć zaklęcia.";
    return;
  }

  const tInfo = await getLockedInfo(spell);
  const hasTargetNow = resolveHasTargetForSpell(spell, tInfo);
  const targetToken = hasTargetNow ? getFirstTargetToken() : null;

  $cast.disabled = hasTargetNow && !targetToken;
  if (hasTargetNow && !targetToken) $castHint.textContent = "Ma cel: wskaż Target (T).";
  else $castHint.textContent = hasTargetNow ? `Cel: ${targetToken?.name ?? targetToken?.actor?.name ?? "—"}` : "Bez celu.";
}

async function persistState() {
  await game.user.setFlag(MODULE_ID, DOCK_STATE_FLAG, {
    expanded: !dock.classList.contains("collapsed"),
    spellId: currentSpellId,
    search: $search?.value ?? "",
    manualHasTarget: !!manualHasTarget,
    variableValue: asIntFloor(variableValue)
  });
}

  function spellNeedsVariable(spell) {
    const c = spell.system?.costs ?? {};
    return costNeedsVariable(c.hitPoints) || costNeedsVariable(c.magicPoints) || costNeedsVariable(c.sanity) || costNeedsVariable(c.power) || costNeedsVariable(c.others);
  }

  async function fillSidePanel(sideEl, sp, info) {
  const headTitle = sideEl.querySelector(".side-title");
  const headMeta  = sideEl.querySelector(".side-meta");
  const bodyEl    = sideEl.querySelector(".side-body");
  if (!headTitle || !headMeta || !bodyEl) return;

  const costs = sp.system?.costs ?? {};
  const cocid = getSpellCoCID(sp) ?? "—";
  const cast  = sp.system?.castingTime ?? "—";
  const typ   = getSpellTypesString(sp);

  const targetTxt = info.locked
    ? (info.hasTarget ? "✅ ma cel (słownik)" : "⭕ bez celu (słownik)")
    : `manual (${manualHasTarget ? "ma cel" : "bez celu"})`;

  headTitle.textContent = sp.name ?? "—";
  headMeta.textContent  = `CoCID: ${cocid} | Cast: ${cast}`;

  bodyEl.innerHTML = `
    <div class="kv">
      <div class="k">Typ</div><div class="v">${escapeHtml(typ)}</div>
      <div class="k">Cel</div><div class="v">${escapeHtml(targetTxt)}</div>
      <div class="k">Koszt</div><div class="v">
        HP ${escapeHtml(costs.hitPoints ?? "0")} |
        MP ${escapeHtml(costs.magicPoints ?? "0")} |
        SAN ${escapeHtml(costs.sanity ?? "0")} |
        POW ${escapeHtml(costs.power ?? "0")}
      </div>
    </div>
    <div class="muted" style="margin-bottom:6px;">PPM na karcie = flyout</div>
    <div class="cocspell-desc" id="side-desc-${sp.id}"><i>Ładuję opis…</i></div>
  `;

  const raw = sp.system?.description?.value ?? "<i>Brak opisu.</i>";
  const descEl = bodyEl.querySelector(`#side-desc-${CSS.escape(sp.id)}`);
  if (descEl) {
    try {
      const enriched = await foundry.applications.ux.TextEditor.implementation.enrichHTML(raw, { secrets: false, rolls: true, documents: true, links: true });
      descEl.innerHTML = enriched;
    } catch (e) {
      console.warn("enrichHTML failed (side panel)", e);
      descEl.innerHTML = raw;
    }
  }

  sideEl.dataset.filled = "1";
}

  async function renderCarousel(filterText = "") {
    const q = String(filterText ?? "").toLowerCase().trim();

    const filtered = allSpells.filter(sp => {
      if (!q) return true;
      const name = String(sp.name ?? "").toLowerCase();
      const types = getSpellTypesString(sp).toLowerCase();
      return name.includes(q) || types.includes(q);
    });

    $track.innerHTML = "";



    for (const sp of filtered) {
      const info = await getLockedInfo(sp);
      const badge = info.locked ? (info.hasTarget ? "🎯" : "⭕") : "？";
      const badgeTitle = info.locked ? (info.hasTarget ? "ma cel (słownik)" : "nie ma celu (słownik)") : "brak w słowniku";

      const card = document.createElement("div");
      card.className = "spell-card";
      card.dataset.spellId = sp.id;
      card.title = `${sp.name}\nCast: ${sp.system?.castingTime ?? "-"}\nTyp: ${getSpellTypesString(sp)}`;
      if (sp.id === currentSpellId) card.classList.add("selected");

card.innerHTML = `
  <div class="spell-img">
    <img src="${escapeHtml(sp.img || "icons/svg/book.svg")}" alt="">
    <button class="card-cast" type="button" title="RZUĆ">RZUĆ</button>
    <div class="spell-badges">
      <span class="badge" title="${escapeHtml(badgeTitle)}">${badge}</span>
    </div>
  </div>

  <div class="card-side" data-filled="0">
    <div class="side-head">
      <div style="min-width:0;">
        <div class="side-title">—</div>
        <div class="side-meta">—</div>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button class="side-cast" type="button" title="Rzuć zaklęcie">RZUĆ</button>
        <button class="side-btn" type="button" title="Zamknij panel">Zwiń</button>
      </div>
    </div>

    <div class="side-body"><i>Kliknij kartę, aby zobaczyć szczegóły.</i></div>
  </div>

  <div class="spell-name">${escapeHtml(sp.name ?? "—")}</div>
`;

      const side = card.querySelector(".card-side");
      const btn = card.querySelector(".side-btn");

  btn?.addEventListener("click", async (ev) => {
  ev.preventDefault();
  ev.stopPropagation();

  if (currentSpellId === sp.id) currentSpellId = null;

  $track.querySelectorAll(".spell-card")
    .forEach(el => el.classList.toggle("selected", el.dataset.spellId === currentSpellId));

  closeFlyout();
  await persistState();
  await updateCastButtonState();
  // safety: jeśli jednak coś zostało selected w collapsed, dofilluj
if (dock.classList.contains("collapsed") && currentSpellId) {
  const cardEl = $track.querySelector(`.spell-card[data-spell-id="${CSS.escape(currentSpellId)}"]`);
  const sideEl = cardEl?.querySelector(".card-side");
  const spNow = spellById.get(currentSpellId);
  if (sideEl && spNow && sideEl.dataset.filled !== "1") {
    const infoNow = await getLockedInfo(spNow);
    await fillSidePanel(sideEl, spNow, infoNow);
  }
}
});

      const castBtn = card.querySelector(".side-cast");

const cardCastBtn = card.querySelector(".card-cast");

cardCastBtn?.addEventListener("click", async (ev) => {
  ev.preventDefault();
  ev.stopPropagation();

  closeFlyout();

  // ustaw jako aktualnie wybrane (żeby zachować spójny state/UI)
  currentSpellId = sp.id;
  $track.querySelectorAll(".spell-card")
    .forEach(el => el.classList.toggle("selected", el.dataset.spellId === currentSpellId));

  const infoNow = await getLockedInfo(sp);
  const hasTargetNow = resolveHasTargetForSpell(sp, infoNow);

  // jeśli jesteśmy w collapsed, dopilnuj wypełnienia side-panelu zaznaczonej karty
if (dock.classList.contains("collapsed")) {
  const cardEl = $track.querySelector(`.spell-card[data-spell-id="${CSS.escape(sp.id)}"]`);
  const sideEl = cardEl?.querySelector(".card-side");
  if (sideEl && sideEl.dataset.filled !== "1") {
    await fillSidePanel(sideEl, sp, infoNow);
  }
}



  await castSpellCore({
    casterToken,
    casterActor,
    spell: sp,
    hasTargetNow,
    variableValue
  });

  updateCasterPanel();
  await updateCastButtonState();
  await persistState();
});

castBtn?.addEventListener("click", async (ev) => {
  ev.preventDefault();
  ev.stopPropagation();
  closeFlyout();

  // upewnij się, że to jest aktualnie wybrane zaklęcie
  currentSpellId = sp.id;
  $track.querySelectorAll(".spell-card")
    .forEach(el => el.classList.toggle("selected", el.dataset.spellId === currentSpellId));

  // odpal cast
  const infoNow = await getLockedInfo(sp);
  const hasTargetNow = resolveHasTargetForSpell(sp, infoNow);

  // podpowiedź/guard: jeśli ma cel, a nie ma targetu, to castSpellCore i tak ostrzeże
  await castSpellCore({
    casterToken,
    casterActor,
    spell: sp,
    hasTargetNow,
    variableValue
  });

  updateCasterPanel();
  await updateCastButtonState();
  await persistState();
});

      // LEFT CLICK: select + show side panel (collapsed) OR renderDetails (expanded)
card.addEventListener("click", async (event) => {
  if (event.target.closest(".cocspell-desc, a, input, label, button")) return;
  const wasSelected = (currentSpellId === sp.id) && card.classList.contains("selected");

  // TOGGLE w collapsed: klik na już rozwiniętej = zwinąć
  if (dock.classList.contains("collapsed") && wasSelected) {
    card.classList.remove("selected");
    currentSpellId = null;
    closeFlyout();
    await persistState();
    await updateCastButtonState();
    return;
  }

  // normalnie: wybierz i rozwiń
  currentSpellId = sp.id;

  $track.querySelectorAll(".spell-card")
    .forEach(el => el.classList.toggle("selected", el.dataset.spellId === currentSpellId));

  if (dock.classList.contains("collapsed")) {
    if (side && side.dataset.filled !== "1") await fillSidePanel(side, sp, info);
    closeFlyout();
    await persistState();
    await updateCastButtonState();
    return;
  }

  await renderDetails();
  await persistState();
});


      // RIGHT CLICK: open flyout (only in collapsed)
      card.addEventListener("contextmenu", async (ev) => {
        if (ev.target.closest(".cocspell-desc, a, input, button")) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (!dock.classList.contains("collapsed")) return;
        await openFlyoutForCard(card, sp, info);
      });

      $track.appendChild(card);
    }

    updateArrows();
// ====== GUARANTEE: w collapsed nigdy nie pokazuj placeholdera w selected card ======
if (dock.classList.contains("collapsed") && currentSpellId) {
  const cardEl = $track.querySelector(`.spell-card[data-spell-id="${CSS.escape(currentSpellId)}"]`);
  if (cardEl) {
    const sideEl = cardEl.querySelector(".card-side");
    const sp = spellById.get(currentSpellId);
    if (sideEl && sp) {
      const infoNow = await getLockedInfo(sp);
      if (sideEl.dataset.filled !== "1") {
        await fillSidePanel(sideEl, sp, infoNow);
      }
    }
    // upewnij się, że selected jest spójny
    cardEl.classList.add("selected");
  }
}
// W expanded: możemy auto-wybrać pierwszy wynik.
// W collapsed: NIE wybieramy nic automatycznie.
if (!filtered.length) {
  currentSpellId = null;
  await renderDetails();
  await persistState();
} else {
  const stillVisible = currentSpellId && filtered.some(s => s.id === currentSpellId);

  if (!stillVisible) {
    if (dock.classList.contains("collapsed")) {
      currentSpellId = null; // brak auto-select
      // tylko odśwież stan przycisku / hintów
      await renderDetails();
      await persistState();
    } else {
      currentSpellId = filtered[0].id; // auto-select tylko w expanded
      await renderDetails();
      await persistState();
    }
  }
}
  }

  // ===================== DETAILS RENDER (EXPANDED) =====================
  const enrichedDescCache = new Map(); // spellId -> enriched html (string)

  async function renderDetails() {
    if (dock.classList.contains("collapsed")) {
      updateCasterPanel();
      await updateCastButtonState();
      return;
    }

    if (!currentSpellId) {
      $spellTitle.textContent = "—";
      $spellMeta.textContent = "—";
      $costs.innerHTML = `<div class="muted">Wybierz zaklęcie.</div>`;
      $desc.innerHTML = `<i>Brak opisu — wybierz zaklęcie.</i>`;
      updateCasterPanel();
      await updateCastButtonState();
      return;
    }

    const spell = spellById.get(currentSpellId);
    if (!spell) {
      $spellTitle.textContent = "—";
      $spellMeta.textContent = "Nie mogę znaleźć zaklętego itemu.";
      $costs.innerHTML = `<div class="muted">—</div>`;
      $desc.innerHTML = `<i>—</i>`;
      updateCasterPanel();
      await updateCastButtonState();
      return;
    }

    const info = await getLockedInfo(spell);

    const cocid = getSpellCoCID(spell) ?? "—";
    const castTime = spell.system?.castingTime ?? "—";
    const typeStr = getSpellTypesString(spell);
    const costsRaw = spell.system?.costs ?? {};

    $spellTitle.textContent = spell.name ?? "—";
    $spellMeta.textContent = `CoCID: ${cocid} | Cast: ${castTime} | Typ: ${typeStr}`;

    const rawDesc = spell.system?.description?.value ?? "<i>Brak opisu.</i>";
    if (enrichedDescCache.has(spell.id)) {
      $desc.innerHTML = enrichedDescCache.get(spell.id);
      $desc.classList.add("cocspell-desc");
    } else {
      await setEnriched($desc, rawDesc);
      enrichedDescCache.set(spell.id, $desc.innerHTML);
    }

    const needsVar = spellNeedsVariable(spell);

    $costs.innerHTML = `
      <div class="row"><span>HP</span><span class="pill"><code>${escapeHtml(costsRaw.hitPoints ?? "0")}</code></span></div>
      <div class="row"><span>MP</span><span class="pill"><code>${escapeHtml(costsRaw.magicPoints ?? "0")}</code></span></div>
      <div class="row"><span>SAN</span><span class="pill"><code>${escapeHtml(costsRaw.sanity ?? "0")}</code></span></div>
      <div class="row"><span>POW</span><span class="pill"><code>${escapeHtml(costsRaw.power ?? "0")}</code></span></div>
      ${costsRaw.others ? `<div class="row"><span>Other</span><span class="pill"><code>${escapeHtml(costsRaw.others)}</code></span></div>` : ""}


      ${!info.locked ? `
  <hr style="border:none;border-top:1px solid rgba(255,255,255,0.06); margin:10px 0;">
  <div class="row">
    <span><b>Cel (manual)</b></span>
    <span>
      <label style="display:flex; align-items:center; gap:8px; font-size:12px; opacity:.9;">
        <input id="${DOCK_ID}-manualTarget" type="checkbox" ${manualHasTarget ? "checked" : ""} />
        <span>${manualHasTarget ? "ma cel" : "bez celu"}</span>
      </label>
    </span>
  </div>
  <div class="muted">To działa tylko dla czarów, których nie ma w słowniku (badge „？”).</div>
` : ``}

      ${needsVar ? `
        <hr style="border:none;border-top:1px solid rgba(255,255,255,0.06); margin:10px 0;">
        <div class="row">
          <span><b>variable</b></span>
          <span>
            <input id="${DOCK_ID}-var" type="number" value="${asIntFloor(variableValue)}" step="1" />
          </span>
        </div>
        <div class="muted">Wartość podstawiana w kosztach typu <code>variable</code>.</div>
      ` : `
        <div class="muted" style="margin-top:6px;">—</div>
      `}
    `;

    const $var = dock.querySelector(`#${DOCK_ID}-var`);
    if ($var) {
      $var.addEventListener("input", async () => {
        variableValue = asIntFloor($var.value);
        await persistState();
      });
    }
;

    const $mt = dock.querySelector(`#${DOCK_ID}-manualTarget`);
    if ($mt) {
      $mt.addEventListener("change", async () => {
        manualHasTarget = !!$mt.checked;
        await persistState();
        await updateCastButtonState();
        await renderDetails();
      });
    }

    updateCasterPanel();
    await updateCastButtonState();
  }

  // ---- header buttons ----
$toggle.addEventListener("click", async () => {
  const wasCollapsed = dock.classList.contains("collapsed");

  dock.classList.toggle("collapsed");
  applyHeights();
  closeFlyout();

  // Jeśli przechodzimy z EXPANDED -> COLLAPSED i mamy wybrane zaklęcie,
  // to od razu wypełnij side-panel tej karty (żeby nie było placeholdera).
  const nowCollapsed = dock.classList.contains("collapsed");
  if (!wasCollapsed && nowCollapsed && currentSpellId) {
    const cardEl = $track.querySelector(`.spell-card[data-spell-id="${CSS.escape(currentSpellId)}"]`);
    const spell = spellById.get(currentSpellId);
    if (cardEl && spell) {
      const sideEl = cardEl.querySelector(".card-side");
      const info = await getLockedInfo(spell);
      if (sideEl && sideEl.dataset.filled !== "1") {
        await fillSidePanel(sideEl, spell, info);
      }
      // Upewnij się, że karta jest zaznaczona (czasem UI bywa "w połowie")
      cardEl.classList.add("selected");
    }
  }

  // COLLAPSED -> EXPANDED: jeśli nie ma wyboru, w expanded wybierz pierwsze (opcjonalnie)
if (wasCollapsed && !nowCollapsed && !currentSpellId && allSpells.length) {
  currentSpellId = allSpells[0].id;
}

  await persistState();
  await renderDetails();
  await updateCastButtonState();
});

$close.addEventListener("click", async () => {
  try { dockCleanup?.(); } catch (e) { console.warn(e); }
  closeDock();
  await persistState();
});

  // search
  $search.value = saved.search ?? "";

  $search.addEventListener("input", () => {
    clearTimeout(searchT);
    searchT = setTimeout(() => renderCarousel($search.value), 120);
  });
  $clear.addEventListener("click", () => {
    $search.value = "";
    clearTimeout(searchT);
    void renderCarousel("");
  });

  // cast click
  $cast.addEventListener("click", async () => {
    const spell = currentSpellId ? spellById.get(currentSpellId) : null;
    if (!spell) return ui.notifications.warn("Wybierz zaklęcie.");

    const info = await getLockedInfo(spell);
    const hasTargetNow = resolveHasTargetForSpell(spell, info);

    await castSpellCore({
      casterToken,
      casterActor,
      spell,
      hasTargetNow,
      variableValue
    });

    updateCasterPanel();
    await updateCastButtonState();
  });

  // resize handler (named)
  function onResize() {
    applyHeights();
    updateArrows();
    renderDetails();
  }
  window.addEventListener("resize", onResize);

  // ====== INIT RENDER ======
  updateCasterPanel();
  await renderCarousel($search.value);
  await renderDetails();
  await persistState();
}
