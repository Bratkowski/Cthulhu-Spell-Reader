import { MODULE_ID, DICT_CACHE_TTL_MS } from "./config.js";
import { normalizeKey } from "./utils.js";

let cache;
let pending;
let generation = 0;

export function clearTargetDictionaryCache() {
  cache = undefined;
  pending = undefined;
  generation++;
}

export function getSpellCoCID(spell) {
  return foundry.utils.getProperty(spell, "flags.CoC7.cocidFlag.id")
    ?? foundry.utils.getProperty(spell, "system.coCID")
    ?? foundry.utils.getProperty(spell, "flags.CoC7.cocid")
    ?? foundry.utils.getProperty(spell, "flags.CoC7.coCID")
    ?? null;
}

export async function getTargetDict() {
  const url = game.settings.get(MODULE_ID, "targetDictionaryUrl").trim();
  if (!url) return new Map();
  if (cache?.url === url && Date.now() - cache.ts < DICT_CACHE_TTL_MS) return cache.map;
  if (pending?.url === url) return pending.promise;

  const requestGeneration = generation;
  const promise = (async () => {
    const map = new Map();
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("Słownik zaklęć musi być tablicą JSON.");
      for (const item of data) {
        const key = normalizeKey(item?.spellName);
        if (key && typeof item.hasTarget === "boolean") map.set(key, item.hasTarget);
      }
    } catch (error) {
      console.warn("Cthulhu Spell Reader | Słownik niedostępny, wybierz cel ręcznie.", error);
    }
    if (generation === requestGeneration) cache = { url, map, ts: Date.now() };
    return map;
  })();
  pending = { url, promise };
  try { return await promise; }
  finally { if (pending?.promise === promise) pending = undefined; }
}

export async function getSpellTargetInfo(spell) {
  const dict = await getTargetDict();
  const cocid = getSpellCoCID(spell);
  const key = cocid ? normalizeKey(cocid) : null;
  const locked = !!key && dict.has(key);
  return { locked, hasTarget: locked ? dict.get(key) : null, key };
}
