export function typeLabel(k) {
  const fallback = ({
    bind: "Bind", call: "Call", combat: "Combat", contact: "Contact", dismiss: "Dismiss",
    enchantment: "Enchantment", gate: "Gate", summon: "Summon", other: "Other"
  })[k] ?? k;
  const key = `CoC7.${k.charAt(0).toUpperCase() + k.slice(1)}Spell`;
  const translated = game.i18n.localize(key);
  return translated === key ? fallback : translated;
}
export function getSpellTypesString(spell) {
  const t = spell.system?.type ?? {};
  const keys = ["bind", "call", "combat", "contact", "dismiss", "enchantment", "gate", "summon"];
  const used = keys.filter(k => !!t?.[k]).map(typeLabel);
  return used.length ? used.join(", ") : "Other";
}

export function getSpellCoCID(spell) {
  return foundry.utils.getProperty(spell, "flags.CoC7.cocidFlag.id")
    ?? foundry.utils.getProperty(spell, "system.coCID")
    ?? foundry.utils.getProperty(spell, "flags.CoC7.cocid")
    ?? foundry.utils.getProperty(spell, "flags.CoC7.coCID")
    ?? null;
}
