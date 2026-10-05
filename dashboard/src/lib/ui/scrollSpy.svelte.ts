/**
 * Which of the elements with these ids is currently near the top of the viewport, so a rail of
 * links can double as a live "you are here". Call during component init (it registers an
 * `$effect`). `ids` is re-read reactively; `active` keeps its last value when nothing intersects,
 * and the band is the top ~30% below an 80px header offset.
 */
export function useScrollSpy(ids: () => string[]) {
  let active = $state<string | null>(null);

  $effect(() => {
    const elements = ids()
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el != null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) active = visible[0].target.id;
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  });

  return {
    get active() {
      return active;
    },
  };
}
