import { updateProgress } from "../progress";
import { getSkipSet } from "../run-tracking";
import { fetchEmailItems, type EmailItem } from "../sources/email";
import { fetchTaskItems } from "../sources/tasks";
import { fetchKeepNotes } from "../sources/keep";
import { fetchGitHubRepos } from "../sources/github";
import { safePhase, type RunCtx } from "./context";

/** What an interrupted run (or `--from-index`) already extracted, so it is neither fetched nor extracted again. */
export interface ResumeSkips {
  emailSkip: Set<string>;
  keepSkip: Set<string>;
  priorEmailCount: number;
  priorNoteCount: number;
}

export interface Fetched {
  emailItems: EmailItem[];
  emailSkipped: number;
  taskItems: Awaited<ReturnType<typeof fetchTaskItems>>;
  keepNotes: Awaited<ReturnType<typeof fetchKeepNotes>>;
  keepSkipSet: Set<string>;
  keepNewCount: number;
  githubRepos: Awaited<ReturnType<typeof fetchGitHubRepos>>;
}

/** Fetches every source. A failing source is logged and left empty; the others still run. */
export async function fetchPhase(ctx: RunCtx, resume: ResumeSkips): Promise<Fetched> {
  const { mode, state, config, fromIndex } = ctx;

  const emailItems: EmailItem[] = [];
  let emailSkipped = 0;
  await safePhase("email-fetch", undefined, async () => {
    const skip = mode === "full" ? new Set<string>() : await getSkipSet("email");
    for (const id of resume.emailSkip) skip.add(id);
    // Each account is an independent IMAP connection with no shared state beyond the skip set
    // (read-only during fetch), so they fetch concurrently instead of one at a time - the mail
    // fetch had become the whole runtime. fetchEmailItems already retries and logs its own errors
    // internally, so a single account's failure never aborts the others.
    const results = await Promise.all(
      (fromIndex ? [] : config.emailAccounts)
        .filter((account) => !account.isNewsAccount)
        .map((account) =>
          fetchEmailItems(account, config.emailYears, skip, {
            onHeaderCount: (n) => {
              state.phases.email.total += n;
              updateProgress(state);
            },
            onItemDone: () => {
              state.phases.email.processed += 1;
              updateProgress(state);
            },
          }),
        ),
    );
    for (const { items, skipped } of results) {
      emailItems.push(...items);
      emailSkipped += skipped;
    }
    state.phases.email.total = emailItems.length + resume.priorEmailCount;
    state.phases.email.processed = resume.priorEmailCount;
    state.phases.email.skipped = emailSkipped;
  });
  updateProgress(state);

  const taskItems = await safePhase("tasks-fetch", [] as Fetched["taskItems"], async () => {
    const items = await fetchTaskItems();
    state.phases.tasks.total = items.length;
    return items;
  });
  state.phases.tasks.done = true;
  updateProgress(state);

  let keepNotes: Fetched["keepNotes"] = [];
  let keepSkipSet = new Set<string>();
  let keepNewCount = 0;
  await safePhase("keep-fetch", undefined, async () => {
    keepSkipSet = mode === "full" ? new Set<string>() : await getSkipSet("keep");
    for (const id of resume.keepSkip) keepSkipSet.add(id);
    keepNotes = fromIndex ? [] : await fetchKeepNotes();
    keepNewCount = keepNotes.filter((n) => !keepSkipSet.has(n.id)).length;
    state.phases.keep.total = keepNewCount + resume.priorNoteCount;
    state.phases.keep.processed = resume.priorNoteCount;
    state.phases.keep.skipped = keepSkipSet.size;
  });
  updateProgress(state);

  const githubRepos = await safePhase("github-fetch", [] as Fetched["githubRepos"], async () => {
    const repos = config.githubToken ? await fetchGitHubRepos(config.githubToken) : [];
    state.phases.github.total = repos.length;
    return repos;
  });
  state.phases.github.done = true;
  updateProgress(state);

  return { emailItems, emailSkipped, taskItems, keepNotes, keepSkipSet, keepNewCount, githubRepos };
}
