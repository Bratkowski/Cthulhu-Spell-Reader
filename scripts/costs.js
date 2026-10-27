import { asIntFloor } from "./utils.js";

// ====== variable detection (for UI) ======
export function costNeedsVariable(raw) {
  if (!raw) return false;
  return /\bvariable\b/i.test(String(raw));
}

// ====== dice segments finder (supports 2d6, d8, 1D10) ======
export function findAllDiceSegments(expr) {
  const re = /\b(\d+)?\s*d\s*\d+\b/gi;
  const out = [];
  let m;
  while ((m = re.exec(expr)) !== null) out.push(m[0]);
  return out;
}

export function hasLettersBesidesVariable(raw) {
  const s = String(raw ?? "");
  // usuń "variable" i sprawdź czy zostały litery (również PL)
  const stripped = s.replace(/variable/ig, "");
  return /[a-ząćęłńóśźż]/i.test(stripped);
}

// ====== normalize arbitrary cost text to safe expression ======
export function normalizeCostExpression(raw) {
  const s = String(raw ?? "").toLowerCase();
  const tokenRe =
    /(\b(\d+)?\s*d\s*\d+\b)|(\bvariable\b)|(\d+(?:\.\d+)?)|([+\-*/()])/gi;

  const tokens = [];
  let m;
  while ((m = tokenRe.exec(s)) !== null) {
    const tok = m[0].replace(/\s+/g, "");
    tokens.push(tok);
  }
  return tokens.join("");
}

// ====== safe math eval (+-*/ and parentheses, supports unary minus) ======
export function safeMathEval(expression) {
  const expr = String(expression).replace(/\s+/g, "");
  if (!expr) return 0;
  const tokens = expr.match(/\d+(?:\.\d+)?|[+\-*/()]/g) ?? [];
  if (tokens.join("") !== expr) throw new Error("Invalid expression");
  let index = 0;
  function primary() {
    const token = tokens[index++];
    if (token === "+") return primary();
    if (token === "-") return -primary();
    if (token === "(") {
      const result = sum();
      if (tokens[index++] !== ")") throw new Error("Mismatched parentheses");
      return result;
    }
    if (token === undefined || !/^\d/.test(token)) throw new Error("Expected number");
    return Number(token);
  }
  function product() {
    let value = primary();
    while (tokens[index] === "*" || tokens[index] === "/") {
      const op = tokens[index++];
      const right = primary();
      if (op === "/" && right === 0) throw new Error("Division by zero");
      value = op === "*" ? value * right : value / right;
    }
    return value;
  }
  function sum() {
    let value = product();
    while (tokens[index] === "+" || tokens[index] === "-") {
      const op = tokens[index++];
      const right = product();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }
  const result = sum();
  if (index !== tokens.length || !Number.isFinite(result)) throw new Error("Bad expression");
  return result;
}

// ====== evalCost that supports variable mixed with dice/math ======
export async function evalCost(raw, variableValue) {
  if (raw === null || raw === undefined) return { amount: 0, detail: "0", raw: "" };
  const rawStr = String(raw).trim();
  if (!rawStr) return { amount: 0, detail: "0", raw: "" };

  let expr = normalizeCostExpression(rawStr);

  if (!expr) {
    return { amount: 0, detail: `${rawStr} (tekst; koszt nieautomatyczny)`, raw: rawStr };
  }

  if (/\bvariable\b/i.test(expr)) {
    expr = expr.replace(/\bvariable\b/gi, String(Math.max(0, asIntFloor(variableValue))));
  }

  const diceSegs = findAllDiceSegments(expr);
  const diceResults = [];
  for (const seg of diceSegs) {
    const clean = seg.replace(/\s+/g, "");
    const roll = await (new Roll(clean)).roll();
    const tot = Math.floor(roll.total ?? 0);
    diceResults.push({ seg: clean, total: tot });
    expr = expr.replace(clean, String(tot));
  }

  let total = 0;
  try {
    total = safeMathEval(expr);
  } catch (e) {
    return { amount: 0, detail: `${rawStr} (błędne wyrażenie po normalizacji: ${expr})`, raw: rawStr };
  }

  const amount = Math.max(0, Math.floor(total));
  const diceNote = diceResults.length
    ? " | dice: " + diceResults.map(d => `${d.seg}→${d.total}`).join(", ")
    : "";

  return { amount, detail: `${rawStr} → ${amount} (expr: ${expr}${diceNote})`, raw: rawStr };
}
