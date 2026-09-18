<script lang="ts">
  /**
   * "A mailbox was never reached on this run."
   *
   * The failure this exists for: Phase 1 does not abort when one source dies - a briefing is worth
   * more partial than absent - so a run with two dead mailboxes still writes a report and still
   * reports `completed`. Every signal on the page then agrees that the morning went fine, and the
   * mail that never arrived looks exactly like mail that was never sent. On 2026-09-14 and again
   * on 2026-09-18 an account failed to authenticate and nothing on the briefing said so.
   *
   * So it sits above the report rather than beside it, and it says which account and how it failed,
   * because "could not connect" and "password rejected" send the reader to different places.
   */
  import { failureLabel, isMailbox, type IngestFailure, type IngestFailureKind } from "#lib/pipeline.js";

  interface Props {
    failures: IngestFailure[];
    /** The date these belong to, for the link into the triage view. */
    date: string;
    /** Set on /[date]/triage, which is itself the list this would otherwise point at. */
    compact?: boolean;
  }

  let { failures, date, compact = false }: Props = $props();

  const KIND_TEXT: Record<IngestFailureKind, string> = {
    timeout: "never answered",
    auth: "rejected the login",
    connection: "could not be reached",
    unknown: "failed",
  };

  const mailboxes = $derived(failures.filter(isMailbox));
  const others = $derived(failures.filter((f) => !isMailbox(f)));

  /** The headline names the mail case when there is one, because that is the one with consequences
   *  the reader can act on - a missed calendar sync is visible, a missed mail is not. */
  const headline = $derived.by(() => {
    const n = mailboxes.length;
    if (n === 0) return `${others.length} ${others.length === 1 ? "source" : "sources"} did not deliver on this run.`;
    const rest = others.length > 0 ? `, and ${others.length} other ${others.length === 1 ? "source" : "sources"} failed` : "";
    return n === 1
      ? `A mail account was not read on this run${rest}.`
      : `${n} mail accounts were not read on this run${rest}.`;
  });
</script>

{#if failures.length > 0}
  <div
    role="alert"
    class="rounded-lg border border-warning-800 bg-warning-950 px-3 py-2.5 text-xs text-warning-400 flex flex-col gap-1.5"
  >
    <p class="font-semibold">{headline}</p>

    <ul class="flex flex-col gap-0.5">
      {#each failures as failure (failure.source + failure.kind)}
        <li>
          <span class="font-medium break-all">{failureLabel(failure)}</span>
          {KIND_TEXT[failure.kind]}{failure.detail ? ` - ${failure.detail}` : ""}
        </li>
      {/each}
    </ul>

    <p>
      {#if mailboxes.length > 0}
        Mail from {mailboxes.length === 1 ? "that account" : "those accounts"} was never fetched, so
        it is missing from this day's briefing rather than left out of it by choice.
      {:else}
        Nothing from {others.length === 1 ? "that source" : "those sources"} reached this run, so
        the briefing was written without it.
      {/if}
    </p>

    <p class="flex flex-wrap gap-x-3 gap-y-1">
      {#if !compact}
        <a href="/{date}/triage" class="underline">What did arrive</a>
      {/if}
      <a href="/runs" class="underline">Every attempt</a>
    </p>
  </div>
{/if}
