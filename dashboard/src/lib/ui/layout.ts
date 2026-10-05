/**
 * The layout scale: container widths and padding for the page frame. `<Page size=...>` is the
 * only thing that should consume these; a page needing a different frame needs a reason first.
 *
 * The widths are also Tailwind theme containers (`--container-read|app|form|legal` in
 * `app.css`), so `max-w-read` works anywhere a class is more convenient than importing this.
 */

export const PAGE_SIZES = {
  /** Report, deep-dive, anything that is prose. 68ch is a comfortable measure. */
  read: "max-w-read",
  /** Tables and dashboards. */
  app: "max-w-app",
  /** Single-column forms: the login gate. */
  form: "max-w-form",
  /** Long-form legal text (privacy, terms): wider than `read`, still a capped prose measure. */
  legal: "max-w-legal",
  /** Deliberately unconstrained: the chat's three-pane grid manages its own width. */
  full: "max-w-none",
} as const;

export type PageSize = keyof typeof PAGE_SIZES;

/** One padding rule for every page. 16px on a phone, where 64px cost a sixth of the screen. */
export const PAGE_PADDING = "px-4 sm:px-6 lg:px-8 2xl:px-12";

/** Vertical rhythm. The extra bottom padding clears the mobile tab bar (visible below `lg`) and
 *  the safe area. */
export const PAGE_VERTICAL = "py-6 pb-[calc(5rem+var(--safe-b))] lg:pb-16";
