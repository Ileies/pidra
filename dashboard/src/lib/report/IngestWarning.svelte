<script lang="ts">
  /**
   * "A mailbox was never reached on this run." Phase 1 carries on when one source dies, so a run
   * with dead mailboxes still reports `completed` and mail that never arrived looks like mail that
   * was never sent. Hence this sits above the report, and names the account and how it failed
   * ("could not connect" vs "password rejected" send the reader to different places).
   * `failures` is the sanitised ingest digest (source and kind, no text) from the mirror.
   */
  import Card from "#lib/components/Card.svelte";
  import { failureLabel, isMailbox, isNewsDesk, type IngestFailure, type IngestFailureKind } from "#lib/pipeline.js";

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
    config: "is not configured",
    unknown: "failed",
  };

  const mailboxes = $derived(failures.filter(isMailbox));
  const others = $derived(failures.filter((f) => !isMailbox(f)));
  /** The reader relies on the News section as their only news, so a gap there is said in its own words. */
  const desks = $derived(failures.filter(isNewsDesk));

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
  <Card tone="warning" role="alert" class="px-3 py-2.5 text-xs text-warning-400 flex flex-col gap-1.5">
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
      {:else if desks.length === others.length}
        The News section was written without {desks.length === 1 ? "that desk" : "those desks"}, so
        whatever {desks.length === 1 ? "it" : "they"} would have found is missing from it, not absent
        from the world.
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
  </Card>
{/if}
