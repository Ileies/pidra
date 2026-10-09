<script lang="ts" module>
  export function pct(value: number): string {
    return `${(value * 100).toFixed(3)}%`;
  }
</script>

<script lang="ts">
  /**
   * One bar for the whole run: each stretch is coloured by the phase that ran. Where two or three
   * phases ran at once, the first one is the solid base and the others lie over it as dashed stripes.
   */
  import { fmtMs } from "#lib/format.js";
  import { groupInfo, type TimeScale } from "#lib/runTrace.js";
  import type { TimelineSegment } from "#lib/runTimeline.js";

  interface Props {
    segments: readonly TimelineSegment[];
    scale: TimeScale;
  }

  let { segments, scale }: Props = $props();

  function overlay(segment: TimelineSegment): string | undefined {
    const rest = segment.groups.slice(1).map((id) => groupInfo(id).color);
    if (rest.length === 0) return undefined;
    // Stripes cycle through the other groups; the gaps show the base colour through.
    const stops = rest.flatMap((color, i) => [`${color} ${i * 10}px ${i * 10 + 6}px`, `transparent ${i * 10 + 6}px ${(i + 1) * 10}px`]);
    return `repeating-linear-gradient(135deg, ${stops.join(", ")})`;
  }

  function title(segment: TimelineSegment): string {
    const names = segment.groups.map((id) => groupInfo(id).label).join(" + ");
    return `${names}: ${fmtMs(segment.endMs - segment.startMs)}, starts at +${fmtMs(segment.startMs)}`;
  }
</script>

<div class="relative h-4 w-full overflow-hidden rounded bg-surface-800" role="img" aria-label="Run timeline by phase">
  {#each segments as segment (segment.startMs)}
    {@const left = scale.at(segment.startMs)}
    {@const right = scale.at(segment.endMs)}
    <span
      class="absolute top-0 h-full"
      style="left:{pct(left)};width:max(2px, {pct(Math.max(0, right - left))});background:{groupInfo(segment.groups[0]).color}"
      title={title(segment)}
    >
      {#if segment.groups.length > 1}
        <span class="absolute inset-0" style="background:{overlay(segment)}"></span>
      {/if}
    </span>
  {/each}
</div>
