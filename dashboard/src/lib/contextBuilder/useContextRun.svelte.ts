import { jsonInit } from "#lib/http.js";
import { netJson } from "#lib/offline/net.js";
import { poll } from "#lib/offline/poll.js";
import { sync } from "#lib/offline/sync.js";
import { toasts } from "#lib/toast.svelte.js";
import type { ContextBuilderStatus } from "#lib/server/contextBuilder.js";
import { errMessage } from "$pipeline/util/text";

type Mode = "full" | "update" | null;
type Outcome = { ok: boolean; error?: string };

/** Live run state (polled every 2s) and the start and stop controls. Call during component init. */
export function useContextRun() {
  let status = $state<ContextBuilderStatus | null>(null);
  let starting = $state(false);
  let stopping = $state(false);

  async function refresh() {
    try {
      const wasRunning = status?.running ?? false;
      status = await netJson<ContextBuilderStatus>("/api/context-builder/status");
      // A run that just finished wrote a new harvest, which this page reads from the offline copy.
      if (wasRunning && !status.running) void sync({ force: true });
    } catch {
      // transient - next poll will retry
    }
  }

  async function command(path: string, init: RequestInit, notify: (message: string) => void, ok: string, failed: string) {
    try {
      const body = await netJson<Outcome>(path, init);
      if (body.ok) notify(ok);
      else toasts.error(body.error ?? failed);
      await refresh();
    } catch (err) {
      toasts.error(errMessage(err));
    }
  }

  async function start(mode: Mode) {
    starting = true;
    try {
      const msg = `Context Builder started${mode ? ` in ${mode} mode` : ""}.`;
      await command("/api/context-builder/start", jsonInit("POST", { mode }), (m) => toasts.success(m), msg, "Failed to start.");
    } finally {
      starting = false;
    }
  }

  async function stop() {
    stopping = true;
    try {
      await command("/api/context-builder/stop", { method: "POST" }, (m) => toasts.show(m), "Context Builder stopped.", "Failed to stop.");
    } finally {
      stopping = false;
    }
  }

  $effect(() => poll(refresh, 2000, { immediate: true }));

  return {
    get status() {
      return status;
    },
    get starting() {
      return starting;
    },
    get stopping() {
      return stopping;
    },
    start,
    stop,
  };
}

export type ContextRun = ReturnType<typeof useContextRun>;
