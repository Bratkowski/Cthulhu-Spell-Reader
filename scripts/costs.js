// Read-only presentation of the ordered CoC7 8.16 costList instructions.
// Never roll formulas, resolve conditions or deduct resources while previewing.
const STEPS = {
  additionalCasterPromptAdd: ["AdditionalCasterPromptAdd", "Dodatkowi rzucający: dodaj grupę", ["prompt", "variable", "step", "min"]],
  additionalCasterCost: ["AdditionalCasterCost", "Koszt dodatkowego rzucającego", ["modify", "value"]],
  additionalCasterPromptRequireNumber: ["AdditionalCasterPromptRequireNumber", "Dodatkowi rzucający: podaj liczbę", ["prompt", "variable"]],
  additionalInformation: ["AdditionalInformation", "Dodatkowe informacje", ["prompt"]],
  castingTime: ["CastingTime", "Czas rzucania", ["value"]],
  casterCost: ["CasterCost", "Koszt rzucającego", ["modify", "value"]],
  promptRequireNumber: ["PromptRequireNumber", "Pytanie: podaj liczbę", ["prompt", "variable"]],
  promptShowText: ["PromptShowText", "Pytanie: pokaż tekst", ["prompt"]],
  showVariable: ["PromptShowVariable", "Pytanie: pokaż zmienną", ["prompt", "variable"]],
  promptShowVariable: ["PromptShowVariable", "Pytanie: pokaż zmienną", ["prompt", "variable"]],
  promptToggleButton: ["PromptToggleButton", "Pytanie: przełącznik", ["prompt", "variable"]],
  setVariable: ["SetVariable", "Ustaw zmienną", ["variable", "value"]],
  triggerPrompt: ["TriggerPrompt", "Wyświetl okno pytań", []]
};

const FIELDS = {
  prompt: ["PromptName", "Treść"],
  variable: ["VariableName", "Zmienna"],
  modify: ["Modify", "Zmieniany zasób"],
  value: ["Value", "Wartość"],
  step: ["GroupSize", "Wielkość grupy"],
  min: ["Minimum", "Minimum"]
};

export function localize(key, fallback) {
  const translated = game.i18n.localize(key);
  return translated === key ? fallback : translated;
}

function display(value) {
  return value !== null && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
}

export function getSpellCosts(spell) {
  const costList = spell.system?.costList ?? [];
  const resources = new Map((CONFIG.Item.dataModels.spell.availableCosts()).map(row => [row.key, row.name]));
  if (costList.length) {
    return {
      automated: true,
      steps: costList.map((step, index) => {
        const definition = STEPS[step.type];
        const config = step.config ?? {};
        // Preserve unknown/new fields rather than silently omitting part of a step.
        const fields = [...new Set([...(definition?.[2] ?? []), ...Object.keys(config)])];
        return {
          number: index + 1,
          title: definition ? localize(`CoC7.Spell.Cost.${definition[0]}`, definition[1]) : step.type,
          condition: display(step.if).trim(),
          fields: fields.filter(key => config[key] !== undefined && config[key] !== null && config[key] !== "").map(key => {
            const field = FIELDS[key];
            return {
              label: field ? localize(`CoC7.Spell.Costs.${field[0]}`, field[1]) : key,
              value: key === "modify" ? resources.get(config[key]) ?? display(config[key]) : display(config[key]),
              formula: key === "value" || key === "variable"
            };
          })
        };
      }),
      legacy: []
    };
  }
  const legacyKeys = { hitPoints: "hp", magicPoints: "mp", sanity: "san", power: "pow" };
  const legacy = Object.entries(spell.system?.costs ?? {})
    .filter(([, value]) => String(value ?? "").trim() !== "" && Number(value) !== 0)
    .map(([key, value]) => ({
      label: key === "others" ? localize("CoC7.OtherCosts", "Inne koszty") : resources.get(legacyKeys[key]) ?? key,
      value: display(value)
    }));
  return { automated: false, steps: [], legacy };
}
