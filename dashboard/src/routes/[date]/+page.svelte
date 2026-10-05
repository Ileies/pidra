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

	// A pipeline trigger is online-only (it needs the server); said before the tap, not after it.

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

	// --- ratings: optimistic, re-synced whenever the load function returns ---

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

	// --- live pipeline status (C7) ---

	let triggering = $state(false);
	const pipeline = usePipelinePoll(() => ({
		date: data.date,
		enabled:
			!data.report && (data.pipelineRun?.status === 'running' || triggering || !!form?.triggered)
	}));

	useReadReceipt(() => ({ date: data.date, enabled: !!data.report }));
</script>

{#snippet statsBar()}
	{#if data.report}
		<!-- The bar says how much was ingested and how much made it. The question that leaves - which
         items, and why not - is the one thing the report itself can never answer, so the link to
         the page that can belongs right here. Its label does not lean on `itemsFiltered`: that is
         a subtraction over what synthesis was handed, not over what arrived, and it reads as
         "0 filtered" on a day where plenty was. Hidden from `xl` up: the rail's "Run stats" card
         says the same thing without needing the reader to scroll back to the top of the page. -->
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

<!-- `size="app"` rather than `read`: the frame needs to be wide enough to hold the rail beside
     the article. The article itself is not capped to the 68ch prose measure at `xl` - it fills
     the left track up to the rail, because a fixed-width article inside a wide `1fr` track left
     it stranded away from the rail with an ugly gap between them. Below `xl` there is no grid and
     no rail, and the article uses the full `app` width. -->
<Page
	title={data.date}
	size="app"
	bleed={statsBar}
	class="xl:grid xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start xl:gap-10"
>
	<div class="flex flex-col gap-5">
		<DayNav
			date={data.date}
			today={data.today}
			prevDate={data.prevDate}
			nextDate={data.nextDate}
		/>

		<!-- Above the briefing, and above the "no report" state too: what a dead mailbox means is that
       the text below is incomplete, which has to be read before the text, not after it. -->
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
				<!-- Speaking a chapter the first time costs money and needs the server, so the button says
         so up front when offline instead of failing after the tap. -->
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

			<!-- Section 2 leads, at every width. It is the actionable half; the briefing
         is the half you read when you have time. -->
			{#if personalEntries > 0 || placement.unplaced.length > 0}
				<EntryGroup
					id="personal"
					title="Personal Action Center"
					groups={data.structured.personal}
					groupKey={(group) => group.urgency}
				>
					{#snippet header(group)}
						{@const meta = URGENCY_META[group.urgency]}
						<!-- The chip carries the meaning; the hue only reinforces it (A4, P7). -->
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

			<!-- What happened, between what needs doing and the newsletters' depth. -->
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
			<!-- The parser found no section headings, or this row predates report_json. The markdown
         renders exactly as it always did, so a prompt drift degrades the layout rather than
         emptying the page (C1). -->
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
