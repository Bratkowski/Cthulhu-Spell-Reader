import { asIntFloor } from "./utils.js";
import { getPOW } from "./actor.js";

// --- CoC7 degrees ---
export const DEG = { FUMBLE: 0, FAIL: 1, REG: 2, HARD: 3, EXTREME: 4, CRIT: 5 };
export function degreeLabel(d) {
  switch (d) {
    case DEG.CRIT: return "CRITICAL";
    case DEG.EXTREME: return "EXTREME";
    case DEG.HARD: return "HARD";
    case DEG.REG: return "REGULAR";
    case DEG.FAIL: return "FAIL";
    case DEG.FUMBLE: return "FUMBLE";
    default: return "—";
  }
}
export function degreeColor(d) {
  switch (d) {
    case DEG.CRIT: return "gold";
    case DEG.EXTREME: return "lime";
    case DEG.HARD: return "lawngreen";
    case DEG.REG: return "springgreen";
    case DEG.FAIL: return "tomato";
    case DEG.FUMBLE: return "red";
    default: return "white";
  }
}
export function isFumble(rollTotal, skill) {
  if (rollTotal === 100) return true;
  if (rollTotal >= 96 && skill < 50) return true;
  return false;
}
export function calcDegree(rollTotal, skill) {
  skill = asIntFloor(skill);
  rollTotal = asIntFloor(rollTotal);

  if (rollTotal === 1) return DEG.CRIT;
  if (isFumble(rollTotal, skill)) return DEG.FUMBLE;

  if (rollTotal <= Math.floor(skill / 5)) return DEG.EXTREME;
  if (rollTotal <= Math.floor(skill / 2)) return DEG.HARD;
  if (rollTotal <= skill) return DEG.REG;
  return DEG.FAIL;
}
export async function rollPOWCheck(actor) {
  const pow = asIntFloor(getPOW(actor));
  const roll = await (new Roll("1d100")).roll();
  const total = roll.total ?? 100;
  const degree = calcDegree(total, pow);
  const success = degree >= DEG.REG;
  return { pow, total, degree, success };
}
export function opposedResult(casterRoll, targetRoll) {
  if (casterRoll.degree > targetRoll.degree) return "caster";
  if (casterRoll.degree < targetRoll.degree) return "target";
  return (casterRoll.total <= targetRoll.total) ? "caster" : "target";
}
