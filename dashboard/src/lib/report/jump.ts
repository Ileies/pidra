/** Scroll a report section into view and move focus there, so a keyboard reader lands where a click did. */
export function jumpToSection(id: string) {
  const el = document.getElementById(id);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
  el?.focus({ preventScroll: true });
}
