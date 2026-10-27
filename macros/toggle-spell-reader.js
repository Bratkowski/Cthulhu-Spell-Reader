const spellReader = game.modules.get("cthulhu-spell-reader");
const tool = ui.controls?.controls?.tokens?.tools?.["cthulhu-spell-reader"];

if (!spellReader?.active) {
  ui.notifications.warn("Włącz moduł Cthulhu Spell Reader.");
} else if (typeof spellReader.api?.toggle === "function") {
  await spellReader.api.toggle();
} else if (typeof tool?.onChange === "function") {
  await tool.onChange();
} else {
  ui.notifications.warn("Nie znaleziono panelu Cthulhu Spell Reader. Zaktualizuj moduł i odśwież świat.");
}
