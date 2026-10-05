<!--
  /[date]: the daily report. Data comes from `+page.ts` (client-only, reads the offline mirror, so the
  page works offline); `+page.server.ts` holds only the `runPipeline` and `rate` form actions.
  Layout: Section 2 (EntryGroup "personal") -> NewsSection -> Section 1 (EntryGroup "intel") -> "Also
  noted"; falls back to `reportHtml` markdown when there is no structured body, and to NoReportState
  when there is no report. Side pieces: DayNav, IngestWarning, SectionNav (below xl), ReportSidebar
  (rail at xl), ReadProgress, and the Play button for the singleton ReportPlayer (mounted in the root layout).
  Per-entry rendering and rating is ReportEntry; section/target helpers are in `$lib/report/view.ts`.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { setPageContext } from '#lib/assistant/state.svelte.js';
	import Page from '#lib/components/Page.svelte';
	import StatBar from '#lib/components/StatBar.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import DayNav from '#lib/report/DayNav.svelte';
	import EntryGroup from '#lib/report/EntryGroup.svelte';
	import EntryHint from '#lib/report/EntryHint.svelte';
	import IngestWarning from '#lib/report/IngestWarning.svelte';
	import NewsSection from '#lib/report/NewsSection.svelte';
	import ReadProgress from '#lib/report/ReadProgress.svelte';
	import QuickActions from '#lib/report/QuickActions.svelte';
	import ReportEntry from '#lib/report/ReportEntry.svelte';
	import { reportPlayer } from '#lib/report/player.svelte.js';
	import Play from '@lucide/svelte/icons/play';
	import SectionNav from '#lib/report/SectionNav.svelte';
	import NoReportState from '#lib/report/NoReportState.svelte';
	import ReportSidebar from '#lib/report/ReportSidebar.svelte';
	import { buildReportDigest } from '#lib/report/digest.js';
	import { usePipelinePoll } from '#lib/report/usePipelinePoll.svelte.js';
	import { useReadReceipt } from '#lib/report/useReadReceipt.svelte.js';
	import { URGENCY_META } from '#lib/report/types.js';
	import { domainTargets, placeActions, runStats, sectionTargets } from '#lib/report/view.js';
	import { fmtCost, fmtNum } from '#lib/format.js';
	import { costUsd, PRICING_CONFIGURED, PRICING_HINT } from '#lib/pricing.js';
	import { toastFormResult } from '#lib/toast.svelte.js';
	import { offline } from '#lib/offline/state.svelte.js';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	$effect(() => toastFormResult(form));

	/**
	 * `/` lands on the newest mirrored day when today's is not mirrored yet. When a background
	 * sync then brings today's, the page offers it rather than swapping the text under the reader.
	 * Only on the arrival itself: a day opened on purpose while today's was already there says nothing.
	 */
	let todayArrived = $state(false);
	let hadToday = untrack(() => data.hasToday);
	let seenDate = untrack(() => data.date);
	$effect(() => {
		if (data.date !== seenDate) {
			seenDate = data.date;
			hadToday = data.hasToday;
			todayArrived = false;
		} else if (!hadToday && data.hasToday) {
			hadToday = true;
			todayArrived = data.date !== data.today;
		}
	});

	// The report surface: the assistant can read this briefing and act on notes, todos, the
	// calendar or the long-term context, but never edit the report. Reports are final.
	$effect(() => {
		setPageContext({
			surface: 'report',
			route: `/${data.date}`,
			digest: buildReportDigest({
				date: data.date,
				today: data.today,
				report: data.report,
				newsGroups,
				pipelineStatus: data.pipelineRun?.status ?? null,
				ingestFailures: data.ingestFailures,
				openActions
			})
		});
	});

	// Ratings are optimistic: a local override that resets whenever the load function returns.
	let ratings = $derived<Record<string, string | null>>({ ...data.ratings });

	function onRate(extractionId: string, eventType: string | null) {
		ratings = { ...ratings, [extractionId]: eventType };
	}

	const cost = $derived(costUsd(data.report?.tokensIn, data.report?.tokensOut));
	const stats = $derived(
		runStats(
			data.report,
			cost,
			PRICING_CONFIGURED ? `Run cost: ${fmtCost(cost)}` : PRICING_HINT
		)
	);

	const personalEntries = $derived(
		data.structured?.personal.reduce((sum, group) => sum + group.entries.length, 0) ?? 0
	);
	const placement = $derived(placeActions(data.structured, data.actions));
	const openActions = $derived(
		data.actions.filter((a) => a.status === 'proposed' || a.status === 'failed')
	);
	// `?? []`: a report mirrored before the News section existed has no `news` at all.
	const newsGroups = $derived(data.structured?.news ?? []);
	const domains = $derived(domainTargets(data.structured));
	const sections = $derived(
		sectionTargets(data.structured, personalEntries > 0 || placement.unplaced.length > 0)
	);

	// Polls /api/pipeline/status only while there is no report yet and a run is (or was just asked to be) running.
	let triggering = $state(false);
	const pipeline = usePipelinePoll(() => ({
		date: data.date,
		enabled:
			!data.report && (data.pipelineRun?.status === 'running' || triggering || !!form?.triggered)
	}));

	useReadReceipt(() => ({ date: data.date, enabled: !!data.report }));

	let articleEl = $state<HTMLElement>();
</script>

{#snippet statsBar()}
	{#if data.report}
		<!-- The link label must not lean on `itemsFiltered`: that is a subtraction over what synthesis
         was handed, not over what arrived, and reads "0 filtered" on days where plenty was.
         Hidden from `xl` up: the rail's "Run stats" card says the same. -->
		<div class="xl:hidden">
			<StatBar {stats}>
				<a
					href="/{data.date}/triage"
					class="text-xs text-primary-400 no-underline hover:text-primary-300 sm:ml-auto"
					title="Every mail of this run and where it stopped"
				>
					What was left out? →
				</a>
			</StatBar>
		</div>
	{/if}
{/snippet}

<!-- `size="app"`, not `read`: wide enough for the rail beside the article. At `xl` the article is not
     capped to the prose measure: it fills the left track up to the rail (a fixed width left a gap).
     Below `xl` there is no grid and no rail. -->
<Page
	title={data.date}
	size="app"
	bleed={statsBar}
	class="xl:grid xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start xl:gap-10"
>
	<div class="flex flex-col gap-5" bind:this={articleEl}>
		<DayNav
			date={data.date}
			today={data.today}
			prevDate={data.prevDate}
			nextDate={data.nextDate}
			latestDate={data.latestDate}
		/>

		<!-- Above the "no report" state too: a dead source means the text below is incomplete. -->
		<IngestWarning failures={data.ingestFailures} date={data.date} />

		{#if todayArrived}
			<p
				role="status"
				class="flex items-center gap-3 rounded-lg border border-primary-800 bg-primary-950 px-3 py-2 text-sm text-primary-200"
			>
				Today's briefing is here.
				<a
					href="/{data.today}"
					class="ml-auto text-primary-300 no-underline hover:text-primary-200"
					>Read it →</a
				>
			</p>
		{/if}

		{#if data.structured}
			{#if !(reportPlayer.open && reportPlayer.date === data.date)}
				<!-- Speaking a chapter the first time costs money and needs the server: disabled offline. -->
				<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
					<button
						type="button"
						disabled={offline.isOffline}
						onclick={() => reportPlayer.start(data.date)}
						class="btn btn-lg btn-primary"
					>
						<Play class="h-4 w-4 shrink-0" aria-hidden="true" fill="currentColor" />
						Play this briefing
					</button>
					{#if offline.isOffline}
						<span class="text-xs text-surface-400">Listening needs the connection.</span>
					{/if}
				</div>
			{/if}

			{#if sections.length > 1}
				<SectionNav {sections} {domains} />
			{/if}

			<EntryHint />

			<!-- Section 2 leads at every width: the actionable half. -->
			{#if personalEntries > 0 || placement.unplaced.length > 0}
				<EntryGroup
					id="personal"
					title="Personal Action Center"
					groups={data.structured.personal}
					groupKey={(group) => group.urgency}
				>
					{#snippet header(group)}
						{@const meta = URGENCY_META[group.urgency]}
						<!-- The chip label carries the meaning; the hue only reinforces it. -->
						<h3
							class="flex items-center gap-2 text-sm font-semibold text-surface-200"
						>
							<Badge tone={meta.tone}>{meta.label}</Badge>
							<span class="text-xs font-normal text-surface-400"
								>{group.entries.length}</span
							>
						</h3>
					{/snippet}
					{#snippet entry(entry, index, group)}
						{@const meta = URGENCY_META[group.urgency]}
						<ReportEntry
							{entry}
							date={data.date}
							{ratings}
							{onRate}
							accent={meta.accent}
							actions={placement.byEntry.get(entry)}
						/>
					{/snippet}
					{#snippet footer()}
						{#if placement.unplaced.length > 0}
							<div class="flex flex-col gap-3">
								<h3 class="text-sm font-semibold text-surface-200">
									Quick actions
								</h3>
								<QuickActions actions={placement.unplaced} showReason />
							</div>
						{/if}
					{/snippet}
				</EntryGroup>
			{:else}
				<!-- An empty panel above the fold is worse than no panel. -->
				<p class="text-sm text-surface-300">Nothing needs action today.</p>
			{/if}

			<NewsSection
				groups={newsGroups}
				date={data.date}
				{ratings}
				{onRate}
				failures={data.ingestFailures}
			/>

			{#if data.structured.intel.length > 0}
				<EntryGroup
					id="intel"
					title="Intelligence Briefing"
					gapClass="gap-6"
					groups={data.structured.intel}
					groupKey={(group) => group.domain}
					groupWrapper={(group, index) => ({ id: `domain-${index}` })}
				>
					{#snippet header(group)}
						<h3
							class="text-sm font-semibold uppercase tracking-wider text-surface-300"
						>
							{group.domain}
						</h3>
					{/snippet}
					{#snippet entry(entry)}
						<ReportEntry {entry} date={data.date} {ratings} {onRate} />
					{/snippet}
				</EntryGroup>
			{/if}

			{#if data.structured.alsoNoted.length > 0}
				<section
					id="also-noted"
					tabindex="-1"
					class="flex flex-col gap-3 scroll-mt-[calc(var(--header-h)+3.5rem)]"
				>
					<h2
						class="text-sm font-semibold uppercase tracking-wider text-surface-300 border-b border-surface-800 pb-2"
					>
						Also noted
					</h2>
					{#each data.structured.alsoNoted as entry, index (index)}
						<ReportEntry {entry} date={data.date} {ratings} {onRate} />
					{/each}
				</section>
			{/if}

			{#if reportPlayer.open}
				<!-- Room for the docked player, so the last entry is not read from under it. -->
				<div class="h-52" aria-hidden="true"></div>
			{/if}
		{:else if data.reportHtml}
			<!-- No section headings parsed, or the row predates report_json: render the markdown, so prompt
         drift degrades the layout instead of emptying the page. -->
			<!-- No entries to attach the actions to, so they lead, each with its reason. -->
			<QuickActions actions={data.actions} showReason />
			<div class="report-body">
				{@html data.reportHtml}
			</div>
		{:else}
			<NoReportState
				date={data.date}
				pipelineRun={data.pipelineRun}
				polling={pipeline.polling}
				liveStatus={pipeline.liveStatus}
				bind:triggering
			/>
		{/if}
	</div>

	{#if data.report && data.structured}
		<ReadProgress target={articleEl} date={data.date} />
	{/if}

	{#if data.report}
		<ReportSidebar
			date={data.date}
			{stats}
			{openActions}
			sectionTargets={sections}
			domainTargets={domains}
			structured={!!data.structured}
		/>
	{/if}

</Page>
