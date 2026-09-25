<script lang="ts">
  /**
   * The quick actions beside a personal entry: "Add to calendar", "Add to to-do", "Mark done",
   * "Update event". Proposed by a separate agent in the pipeline (`src/actions/`), which is told
   * that no action is the normal answer, so most entries carry none.
   *
   * Each shows exactly what a tap writes - the title, the time, the place - so the one tap is an
   * informed one. The tap runs the skill on the bridge; the answer is shown at once and the sync
   * that follows brings the same state into the mirror.
   *
   * Online-only, never queued: it writes to Google Calendar or Tasks, and replaying that days
   * later against an event that has moved on would be wrong. Offline the buttons are disabled
   * with the reason, and a tap that loses the connection says whether it may have gone through.
   * A second tap on one that did is harmless: the bridge answers "done" instead of adding again.
   */
  import Spinner from "#lib/components/Spinner.svelte";
  import { fmtDay, fmtSpan } from "#lib/format.js";
  import { netJson, NetError } from "#lib/offline/net.js";
  import { offline } from "#lib/offline/state.svelte.js";
  import { sync } from "#lib/offline/sync.js";
  import { ACTION_META, type ActionPreview, type ActionStatus, type QuickAction } from "#lib/report/types.js";
  import { toasts } from "#lib/toast.svelte.js";

  interface Props {
    actions: QuickAction[];
    /** Say what the mail asked, for actions no report entry explains. */
    showReason?: boolean;
  }

  let { actions, showReason = false }: Props = $props();

  type LocalStatus = ActionStatus | "dismissed";

  /** What a tap changed, ahead of the sync that writes the same into the mirror. */
  let local = $state<Record<string, LocalStatus>>({});
  let busy = $state<Record<string, boolean>>({});

  const isOffline = $derived(offline.reachable === "offline");
  const shown = $derived(
    actions
      .map((action) => ({ ...action, status: local[action.id] ?? action.status }))
      .filter((action) => action.status !== "dismissed"),
  );

  function details(preview: ActionPreview): string[] {
    switch (preview.kind) {
      case "add_event":
        return [fmtSpan(preview.start, preview.end, preview.allDay), preview.location ?? ""];
      case "update_event": {
        const moved = preview.start !== preview.was.start || preview.end !== preview.was.end;
        return moved
          ? [fmtSpan(preview.start, preview.end, preview.allDay), preview.location ?? "", `was ${fmtSpan(preview.was.start, preview.was.end, preview.was.allDay)}`]
          : [preview.location ?? "", preview.was.location ? `was ${preview.was.location}` : ""];
      }
      case "add_todo":
        return [preview.due ? `Due ${fmtDay(preview.due)}` : "", preview.notes ?? ""];
      case "complete_todo":
        return [`On ${preview.list}`];
    }
  }

  function tapError(err: unknown): string {
    if (err instanceof NetError) {
      return err.sent
        ? `${err.message} It may have gone through; the report shows it once the connection is back.`
        : `Not sent: ${err.message.toLowerCase()}`;
    }
    return err instanceof Error ? err.message : String(err);
  }

  /** What a handler needs of an action; the rows it gets carry the local status on top. */
  type Target = Pick<QuickAction, "id" | "preview">;

  async function post(action: Target, op: "run" | "dismiss" | "restore") {
    return netJson<{ status: LocalStatus; message: string }>(`/api/actions/${action.id}/${op}`, { method: "POST" });
  }

  async function run(action: Target) {
    const meta = ACTION_META[action.preview.kind];
    busy[action.id] = true;
    try {
      const res = await post(action, "run");
      local[action.id] = res.status;
      if (res.status === "done") toasts.success(`${meta.done}: ${action.preview.title}`);
      else if (res.status === "queued") toasts.show("Queued for approval on /skills.");
      else toasts.error(`${meta.verb} did not work: ${res.message}`);
    } catch (err) {
      toasts.error(tapError(err));
    } finally {
      busy[action.id] = false;
      void sync({ force: true });
    }
  }

  async function dismiss(action: Target) {
    busy[action.id] = true;
    try {
      await post(action, "dismiss");
      local[action.id] = "dismissed";
      toasts.success("Suggestion dismissed.", async () => {
        await post(action, "restore");
        local[action.id] = "proposed";
        void sync({ force: true });
      });
    } catch (err) {
      toasts.error(tapError(err));
    } finally {
      busy[action.id] = false;
      void sync({ force: true });
    }
  }
</script>

{#snippet icon(kind: ActionPreview["kind"])}
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="mt-0.5 h-4 w-4 shrink-0 text-primary-400" aria-hidden="true">
    {#if kind === "add_event" || kind === "update_event"}
      <rect x="3" y="4" width="14" height="13" rx="1.5" />
      <path d="M3 8h14M7 2.5v3M13 2.5v3" />
    {:else if kind === "add_todo"}
      <path d="M10 4.5v11M4.5 10h11" />
    {:else}
      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
    {/if}
  </svg>
{/snippet}

{#if shown.length > 0}
  <ul class="flex flex-col gap-2" aria-label="Quick actions">
    {#each shown as action (action.id)}
      {@const meta = ACTION_META[action.preview.kind]}
      {@const lines = details(action.preview).filter(Boolean)}
      <li class="flex flex-col gap-2 rounded-md border border-surface-700 bg-surface-900 px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
        <div class="flex min-w-0 flex-1 items-start gap-2">
          {@render icon(action.preview.kind)}
          <div class="min-w-0 flex flex-col gap-0.5">
            <span class="text-sm text-surface-50 break-words">{action.preview.title}</span>
            {#if lines.length > 0}
              <span class="text-xs text-surface-400 break-words">{lines.join(" · ")}</span>
            {/if}
            {#if showReason && action.reason}
              <span class="text-xs text-surface-400 break-words">{action.reason}</span>
            {/if}
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-2 pl-6 sm:pl-0">
          {#if action.status === "done"}
            <span class="inline-flex items-center gap-1 rounded bg-success-950 px-2 py-1 text-xs text-success-400">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" class="h-3 w-3" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg>
              {meta.done}
            </span>
          {:else if action.status === "queued"}
            <a href="/skills" class="text-xs text-primary-400 no-underline hover:text-primary-300">Waiting for approval on /skills</a>
          {:else if action.status === "running" || busy[action.id]}
            <span class="inline-flex items-center gap-2 text-xs text-surface-400">
              <Spinner label="Working" />
              Working…
            </span>
          {:else}
            {#if isOffline}
              <span class="text-xs text-surface-400">Needs the connection</span>
            {:else if action.status === "failed"}
              <span class="text-xs text-error-400">Did not go through</span>
            {/if}
            <button
              type="button"
              disabled={isOffline}
              onclick={() => run(action)}
              class="tap px-3 py-1.5 rounded text-xs bg-primary-900 border border-primary-600 text-primary-200 cursor-pointer hover:bg-primary-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {action.status === "failed" ? "Try again" : meta.verb}
            </button>
            <button
              type="button"
              disabled={isOffline}
              onclick={() => dismiss(action)}
              aria-label="Dismiss this suggestion"
              title="Dismiss this suggestion"
              class="tap px-2.5 py-1.5 rounded text-xs border border-surface-500 text-surface-300 cursor-pointer hover:bg-surface-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <span aria-hidden="true">×</span>
            </button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
{/if}
