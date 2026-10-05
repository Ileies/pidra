import { netJson } from "#lib/offline/net.js";
import { poll } from "#lib/offline/poll.js";
import { sync } from "#lib/offline/sync.js";

/**
 * Follows a running pipeline while `enabled`: the report reaches the page through the mirror like
 * any other, so once the run ends a forced sync re-runs the load. Call during component init.
 * Polls `GET /api/pipeline/status?date=` every 5 s (online only) and stops itself when the report
 * exists or the run failed. `polling` / `liveStatus` are reactive getters for NoReportState.
 */
export function usePipelinePoll(args: () => { date: string; enabled: boolean }) {
  let polling = $state(false);
  let liveStatus = $state<string | null>(null);

  $effect(() => {
    const { date, enabled } = args();
    if (!enabled) return;
    polling = true;
    const stop = poll(async () => {
      const body = await netJson<{ hasReport: boolean; run: { status: string } | null }>(
        `/api/pipeline/status?date=${date}`,
      );
      liveStatus = body.run?.status ?? null;
      if (body.hasReport || body.run?.status === "failed") {
        stop();
        polling = false;
        await sync({ force: true });
      }
    }, 5000);
    return () => {
      stop();
      polling = false;
    };
  });

  return {
    get polling() {
      return polling;
    },
    get liveStatus() {
      return liveStatus;
    },
  };
}
