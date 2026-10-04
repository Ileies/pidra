import { netJson } from "#lib/offline/net.js";
import { navBadges } from "#lib/navBadges.svelte.js";

/** A report is acknowledged only once the reader reaches its actual end. Call during component init. */
export function useReadReceipt(args: () => { date: string; enabled: boolean }) {
  $effect(() => {
    const { date, enabled } = args();
    if (!enabled) return;
    let marked = false;
    let sending = false;
    const checkBottom = async () => {
      if (marked || sending) return;
      if (window.scrollY + window.innerHeight < document.documentElement.scrollHeight - 2) return;
      sending = true;
      try {
        await netJson(`/api/notifications/report-read/${date}`, { method: "POST" });
        marked = true;
        void navBadges.refresh();
      } catch {
        // Stay eligible for another attempt if the connection is unavailable.
      } finally {
        sending = false;
      }
    };
    window.addEventListener("scroll", checkBottom, { passive: true });
    window.addEventListener("resize", checkBottom);
    void checkBottom();
    return () => {
      window.removeEventListener("scroll", checkBottom);
      window.removeEventListener("resize", checkBottom);
    };
  });
}
