const spellReader = game.modules.get("cthulhu-spell-reader");
if (!spellReader?.active || !spellReader.api) {
  ui.notifications.warn("Włącz moduł Cthulhu Spell Reader.");
} else {
  await spellReader.api.toggle();
}
