export function getCasterTokenSmart() {
  if (game.user.isGM) {
    const t = canvas.tokens.controlled?.[0];
    if (!t) ui.notifications.warn("GM: zaznacz token rzucającego zaklęcie.");
    return t ?? null;
  }

  const actor = game.user.character;
  if (!actor) {
    ui.notifications.warn("Gracz: nie masz przypisanej postaci (User -> Character).");
    return null;
  }

  const controlled = canvas.tokens.controlled?.find(t => t.actor?.id === actor.id);
  if (controlled) return controlled;

  const tokens = canvas.tokens.placeables.filter(t => t.actor?.id === actor.id);
  if (tokens.length === 1) return tokens[0];

  if (tokens.length > 1) {
    const cx = canvas.stage.pivot.x * -1 + canvas.dimensions.width / 2;
    const cy = canvas.stage.pivot.y * -1 + canvas.dimensions.height / 2;
    tokens.sort((a, b) => (
      Math.hypot(a.center.x - cx, a.center.y - cy) -
      Math.hypot(b.center.x - cx, b.center.y - cy)
    ));
    return tokens[0];
  }

  ui.notifications.warn(`Gracz: nie widzę tokenu postaci "${actor.name}" na tej scenie.`);
  return null;
}

// ---------- CoC7 resources ----------
export function getPOW(actor) {
  return foundry.utils.getProperty(actor, "system.characteristics.pow.value")
    ?? foundry.utils.getProperty(actor, "system.characteristics.pow")
    ?? 0;
}
export function getHP(actor) {
  return foundry.utils.getProperty(actor, "system.attribs.hp.value")
    ?? foundry.utils.getProperty(actor, "system.hp.value")
    ?? 0;
}
export function getMP(actor) {
  return foundry.utils.getProperty(actor, "system.attribs.mp.value")
    ?? foundry.utils.getProperty(actor, "system.mp.value")
    ?? 0;
}
export function getSAN(actor) {
  return foundry.utils.getProperty(actor, "system.attribs.san.value")
    ?? foundry.utils.getProperty(actor, "system.san.value")
    ?? 0;
}
