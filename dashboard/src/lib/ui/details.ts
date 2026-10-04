/** Opens every `<details>` around `el`, so a scroll target inside collapsed sections is visible. */
export function openAncestors(el: HTMLElement): void {
  let details = el.closest("details");
  while (details) {
    details.open = true;
    details = details.parentElement?.closest("details") ?? null;
  }
}
