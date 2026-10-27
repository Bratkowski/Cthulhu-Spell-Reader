// CoC7's "Test Cast" button calls system.cast(true).
// The system owns all prompts, formulas, resource changes and chat output.
const pendingActors = new Set();

export async function castSpell(spell) {
  const actor = spell?.actor ?? spell?.parent;
  if (!actor?.isOwner || spell?.type !== "spell") {
    ui.notifications.warn("Nie masz uprawnień do rzucania tego zaklęcia.");
    return false;
  }
  if (typeof spell.system?.cast !== "function") {
    ui.notifications.error("System CoC7 nie udostępnia funkcji rzucania zaklęć.");
    return false;
  }
  const key = actor.uuid ?? actor;
  if (pendingActors.has(key)) return false;
  pendingActors.add(key);
  try {
    await spell.system.cast(true);
    return true;
  } catch (error) {
    console.error("Cthulhu Spell Reader | Systemowe rzucanie zaklęcia nie powiodło się", error);
    ui.notifications.error("Nie udało się rzucić zaklęcia. Szczegóły w konsoli.");
    return false;
  } finally {
    pendingActors.delete(key);
  }
}
