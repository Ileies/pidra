<script lang="ts" module>
  export function pct(value: number): string {
    return `${(value * 100).toFixed(3)}%`;
  }
</script>

<script lang="ts">
  /**
   * One bar for the whole run: each stretch is coloured by the phase that ran. Where two or three
   * phases ran at once, the stretch is cut into equal diagonal stripes, one colour per phase.
   */
  import { fmtMs } from "#lib/format.js";
  import { groupInfo, type TimeScale } from "#lib/runTrace.js";
  import type { TimelineSegment } from "#lib/runTimeline.js";

  interface Props {
    segments: readonly TimelineSegment[];
    scale: TimeScale;
  }

  let { segments, scale }: Props = $props();

  const STRIPE_PX = 6;

  /** One colour for a lone group; equal-width diagonal stripes of every running group otherwise. */
  function fill(segment: TimelineSegment): string {
    const colors = segment.groups.map((id) => groupInfo(id).color);
    if (colors.length === 1) return colors[0];
    const stops = colors.map((color, i) => `${color} ${i * STRIPE_PX}px ${(i + 1) * STRIPE_PX}px`);
    return `repeating-linear-gradient(135deg, ${stops.join(", ")})`;
  }

  function title(segment: TimelineSegment): string {
    const names = segment.groups.map((id) => groupInfo(id).label).join(" + ");
    return `${names}: ${fmtMs(segment.endMs - segment.startMs)}, starts at +${fmtMs(segment.startMs)}`;
  }
</script>

<div
  class="relative h-4 w-full overflow-hidden rounded bg-surface-800"
  style="container-type:inline-size"
  role="img"
  aria-label="Run timeline by phase"
>
  {#each segments as segment (segment.startMs)}
    {@const left = scale.at(segment.startMs)}
    {@const right = scale.at(segment.endMs)}
    <!-- Each stripe fill is a window onto a gradient sized to the whole bar (100cqw), so a colour that
         spans two neighbouring stretches continues across them at any screen width. -->
    <span
      class="absolute top-0 h-full"
      style="left:{pct(left)};width:max(2px, {pct(Math.max(0, right - left))});background:{fill(segment)};background-size:100cqw 100%;background-position:calc({-left} * 100cqw) 0"
      title={title(segment)}
    ></span>
  {/each}
</div>
