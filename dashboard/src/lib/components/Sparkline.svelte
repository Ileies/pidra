<script lang="ts">
  /**
   * A small series with an axis, a range and a readable value (B2).
   *
   * The version this replaces was a bare dot scatter with no axis, no labels and no tooltip:
   * `source_daily_scores` rendered as decoration. It now has a baseline, a midline, min/max
   * labels, and a title that says what the series is - so the shape means something.
   */
  export interface Point {
    /** Whatever names the x position in a tooltip: a date, usually. */
    at: string;
    value: number | null;
  }

  interface Props {
    points: Point[];
    /** Series maximum, so several sparklines on one page share a scale. */
    max?: number;
    /** Thresholds for the value colour, high to low. */
    tone?: (value: number) => string;
    width?: number;
    height?: number;
    label?: string;
  }

  let {
    points,
    max = 10,
    tone = defaultTone,
    width = 80,
    height = 24,
    label = "Daily score",
  }: Props = $props();

  function defaultTone(value: number): string {
    if (value >= 7.5) return "var(--color-success-500)";
    if (value >= 5) return "var(--color-warning-500)";
    return "var(--color-error-500)";
  }

  const scored = $derived(points.filter((p): p is Point & { value: number } => p.value != null));

  const stats = $derived(
    scored.length === 0
      ? null
      : {
          min: Math.min(...scored.map((p) => p.value)),
          max: Math.max(...scored.map((p) => p.value)),
          last: scored[scored.length - 1].value,
        },
  );

  const pad = 1.5;
  const x = (i: number) => (i / Math.max(points.length - 1, 1)) * (width - pad * 2) + pad;
  const y = (value: number) => height - pad - (Math.min(value, max) / max) * (height - pad * 2);

  const linePath = $derived(
    points
      .map((p, i) => (p.value == null ? null : `${x(i)},${y(p.value)}`))
      .filter(Boolean)
      .join(" "),
  );

  const title = $derived(
    stats
      ? `${label}: ${stats.min.toFixed(1)}-${stats.max.toFixed(1)} over ${points.length} days, latest ${stats.last.toFixed(1)}`
      : `${label}: no data`,
  );
</script>

{#if points.length === 0}
  <span class="text-xs text-surface-400">No data</span>
{:else}
  <span class="inline-flex items-center gap-1.5" {title}>
    <svg
      class="block shrink-0"
      style="width: {width}px; height: {height}px"
      viewBox="0 0 {width} {height}"
      role="img"
      aria-label={title}
    >
      <!-- Baseline and midline: without them a dot's height means nothing. -->
      <line x1="0" y1={height - pad} x2={width} y2={height - pad} stroke="var(--color-surface-700)" stroke-width="1" />
      <line
        x1="0"
        y1={y(max / 2)}
        x2={width}
        y2={y(max / 2)}
        stroke="var(--color-surface-800)"
        stroke-width="1"
        stroke-dasharray="2 3"
      />
      {#if linePath}
        <polyline points={linePath} fill="none" stroke="var(--color-surface-600)" stroke-width="1" />
      {/if}
      {#each points as point, i (point.at)}
        {#if point.value != null}
          <circle cx={x(i)} cy={y(point.value)} r="1.5" fill={tone(point.value)} />
        {/if}
      {/each}
    </svg>
    {#if stats}
      <span class="text-xs text-surface-400 tabular-nums whitespace-nowrap">
        {stats.min.toFixed(1)}–{stats.max.toFixed(1)}
      </span>
    {/if}
  </span>
{/if}
