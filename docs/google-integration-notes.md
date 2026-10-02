# Google Tasks and Keep notes

What each of the owner's Google Tasks lists and Keep categories is *for*. Nothing in the code branches on these names (the lists and notes reach the models as data), so this is the reference for reading Section 2 and the Context Builder's task and Keep summaries, and for judging whether a prompt treats a list sensibly. Taken from the owner's setup on 2026-09-10; check the live lists for what exists now.

## Google Tasks

| List | How Section 2 should treat it |
|---|---|
| To-Do Now | Highest priority. Surface if a deadline approaches or an email references it. |
| Work | Client and project work. Cross-reference incoming client emails. |
| Uni | University deadlines. Same urgency treatment as Work. |
| To-Do Later | Surface only if an email or calendar event makes an item suddenly urgent. |
| Shopping List | Low priority. Surface only if an email references a purchase or price alert. |
| Plans & Goals | Medium-term goals. Relevant when the news intersects with a goal. |
| Dreams | Long-term aspirations. Rarely relevant unless a major opportunity arises. |
| Daily Life Rules | High value: the owner's standing operating rules. |
| RizinOS | Project-specific. Cross-reference RizinOS-related news if tracked. |
| To Sort | Messy backlog. Never reference without explicit instruction. |

**Default list for system-created tasks:** "To-Do Now" (decided 2026-09-10). System items come from email deadlines and are time-sensitive, so they belong in the list checked daily, not a project backlog. The default is a list *title*, resolved to an id at call time by `resolveTaskList` (`src/ingest/google.ts`); `GOOGLE_TASKS_DEFAULT_LIST` overrides it without a deploy, and a missing list falls back to `@default`.

## Google Keep

Keep has about 1,000 notes. The Context Builder (`context-builder/sources/keep.ts`) fetches them and withholds `Credentials`-labelled notes (see `docs/architecture-rules.md`). Standing rules written in Keep seed `standing_context` under stable `keep_rule_<note_id>` keys. The categories below are the owner's own and say how much weight a note deserves:

| Category | Value |
|---|---|
| Memories | High: specific information not to forget, may hold contact context or commitments |
| Favorites | High: curated "best of" lists, relevant to entity importance |
| Shower Ideas | Medium: project and product ideas ahead of their time |
| Recommendations | Medium: products, services, travel destinations |
| Full Travel Plans | Medium: future trips (a China trip should set the China pre-trip window) |
| Thoughts | Low-medium: personal reflections, may overlap with the diary |
| Learning Chinese | Low for the briefing: personal learning notes |
| Quotes | Low: saved quotes |
| Random | Low: miscellaneous |
| To-Do | Low: mostly old; not active tasks, those live in Google Tasks |
| Archived | Very low: historical |
