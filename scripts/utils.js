export function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
export function asIntFloor(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}
