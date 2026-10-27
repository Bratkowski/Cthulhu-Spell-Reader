import { MODULE_ID, SYSTEM_ID, SPELL_DICT_JSON_URL } from "./config.js";
import { getCasterTokenSmart } from "./actor.js";
import { closeDock, isDockOpen, openDock } from "./spell-dock.js";
import { clearTargetDictionaryCache } from "./target-dictionary.js";

let opening = false;

export async function toggleSpellReader() {
  if (opening) return;
  if (isDockOpen()) return closeDock();
  if (game.system.id !== SYSTEM_ID) return;
  if (!canvas.ready) return ui.notifications.warn("Najpierw otwórz scenę z tokenem postaci.");
  const casterToken = getCasterTokenSmart();
  const casterActor = casterToken?.actor;
  if (!casterActor) return;
  if (!casterActor.isOwner) return ui.notifications.warn("Nie masz uprawnień do tej postaci.");

  opening = true;
  try { await openDock({ casterToken, casterActor }); }
  catch (error) {
    closeDock();
    console.error("Cthulhu Spell Reader | Nie udało się otworzyć panelu", error);
    ui.notifications.error("Nie udało się otworzyć panelu zaklęć. Szczegóły w konsoli.");
  } finally { opening = false; }
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "targetDictionaryUrl", {
    name: "Adres słownika celów zaklęć",
    hint: "URL lub ścieżka do JSON z polami spellName (CoCID) i hasTarget (boolean). Puste pole włącza ręczny wybór celu.",
    scope: "world",
    config: true,
    type: String,
    default: SPELL_DICT_JSON_URL,
    onChange: () => {
      clearTargetDictionaryCache();
      closeDock();
    }
  });
  game.keybindings.register(MODULE_ID, "toggle", {
    name: "Otwórz / zamknij panel zaklęć",
    editable: [],
    onDown: () => { void toggleSpellReader(); return true; }
  });
});

Hooks.once("ready", () => {
  if (game.system.id !== SYSTEM_ID) return;
  game.modules.get(MODULE_ID).api = Object.freeze({
    toggle: toggleSpellReader,
    close: closeDock,
    clearTargetDictionaryCache
  });
});

Hooks.on("getSceneControlButtons", controls => {
  if (game.system.id !== SYSTEM_ID || !controls.tokens) return;
  controls.tokens.tools[MODULE_ID] = {
    name: MODULE_ID,
    title: "Cthulhu Spell Reader — zaklęcia",
    icon: "fa-solid fa-book-skull",
    order: Object.keys(controls.tokens.tools).length,
    button: true,
    onChange: () => { void toggleSpellReader(); }
  };
});

Hooks.on("canvasTearDown", closeDock);
