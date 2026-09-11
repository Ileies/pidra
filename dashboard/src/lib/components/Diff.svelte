<script lang="ts">
  /**
   * Line-level diff with collapsed context (D6).
   *
   * /prompts showed the full text of every version in a `<pre>` with nothing to compare it
   * against, so approving a prompt change meant reading two long blocks side by side in your
   * head and hoping. This is the one page where the plan explicitly demands human judgement, so
   * it should be possible to exercise it.
   *
   * Unchanged runs longer than `context * 2` collapse to a one-line marker, which is what makes
   * a three-word edit to a 60-line prompt visible at a glance.
   */
  import { diffLines } from "diff";

  interface Props {
    before: string;
    after: string;
    beforeLabel?: string;
    afterLabel?: string;
    /** Unchanged lines kept either side of a change. */
    context?: number;
  }

  let { before, after, beforeLabel = "Active", afterLabel = "Proposed", context = 3 }: Props = $props();

  type Row = { kind: "add" | "remove" | "same"; text: string } | { kind: "skip"; count: number };

  const rows = $derived.by<Row[]>(() => {
    const out: Row[] = [];

    for (const part of diffLines(before, after)) {
      const lines = part.value.replace(/\n$/, "").split("\n");
      if (part.added) {
        for (const line of lines) out.push({ kind: "add", text: line });
      } else if (part.removed) {
        for (const line of lines) out.push({ kind: "remove", text: line });
      } else if (lines.length > context * 2 + 1) {
        // Head, marker, tail. The marker says how much was skipped so the collapse is visible.
        for (const line of lines.slice(0, context)) out.push({ kind: "same", text: line });
        out.push({ kind: "skip", count: lines.length - context * 2 });
        for (const line of lines.slice(-context)) out.push({ kind: "same", text: line });
      } else {
        for (const line of lines) out.push({ kind: "same", text: line });
      }
    }

    return out;
  });

  const added = $derived(rows.filter((row) => row.kind === "add").length);
  const removed = $derived(rows.filter((row) => row.kind === "remove").length);

  const ROW_CLASS = {
    add: "bg-success-950 text-success-200",
    remove: "bg-error-950 text-error-200",
    same: "text-surface-400",
  } as const;

  // The glyph, not the hue, is what says which side a line is on (A4).
  const MARK = { add: "+", remove: "−", same: " " } as const;
</script>

<div class="rounded-lg border border-surface-700 overflow-hidden">
  <div class="flex flex-wrap items-center gap-3 border-b border-surface-700 bg-surface-900 px-3 py-2 text-xs">
    <span class="text-surface-400">{beforeLabel} → {afterLabel}</span>
    <span class="text-success-400 tabular-nums">+{added}</span>
    <span class="text-error-400 tabular-nums">−{removed}</span>
    {#if added === 0 && removed === 0}
      <span class="text-surface-400">Identical.</span>
    {/if}
  </div>

  <div class="max-h-96 overflow-auto bg-surface-950">
    <table class="w-full border-collapse font-mono text-xs">
      <tbody>
        {#each rows as row, index (index)}
          {#if row.kind === "skip"}
            <tr>
              <td class="w-6 select-none bg-surface-900 text-center text-surface-400">⋯</td>
              <td class="bg-surface-900 px-2 py-0.5 text-surface-400">{row.count} unchanged lines</td>
            </tr>
          {:else}
            <tr class={ROW_CLASS[row.kind]}>
              <td class="w-6 select-none border-r border-surface-800 text-center opacity-70" aria-hidden="true">{MARK[row.kind]}</td>
              <td class="whitespace-pre-wrap break-words px-2 py-0.5">{row.text || " "}</td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
</div>
