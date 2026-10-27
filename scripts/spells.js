export function typeLabel(k) {
  return ({
    bind: "Bind", call: "Call", combat: "Combat", contact: "Contact", dismiss: "Dismiss",
    enchantment: "Enchantment", gate: "Gate", summon: "Summon", other: "Other"
  })[k] ?? k;
}
export function getSpellTypesString(spell) {
  const t = spell.system?.type ?? {};
  const keys = ["bind", "call", "combat", "contact", "dismiss", "enchantment", "gate", "summon"];
  const used = keys.filter(k => !!t?.[k]).map(typeLabel);
  return used.length ? used.join(", ") : "Other";
}
