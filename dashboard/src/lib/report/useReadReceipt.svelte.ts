import { flush, markReportRead } from "#lib/offline/outbox.js";
import { navBadges } from "#lib/navBadges.svelte.js";

/**
 * A report is acknowledged only once the reader reaches its actual end (page bottom). Call during
 * component init. The receipt goes through the offline outbox (`report.read`): it marks the mirror
 * at once, works offline, and reaches the server and every other device on the next flush and sync.
 * Pass `enabled: false` once the mirror already says read.
 */
export function useReadReceipt(args: () => { date: string; enabled: boolean }) {
  $effect(() => {
    const { date, enabled } = args();
    if (!enabled) return;
    let marked = false;
    const checkBottom = async () => {
      if (marked) return;
      if (window.scrollY + window.innerHeight < document.documentElement.scrollHeight - 2) return;
      marked = true;
      try {
        await markReportRead(date);
        void flush().then(() => navBadges.refresh());
      } catch {
        marked = false;
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
