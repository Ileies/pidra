# Google Tasks and Keep integration notes

Category-meaning reference for Section 2 (Tasks) and the Context Builder (Keep). Item counts below are a point-in-time snapshot from initial planning (2026-09-10) - useful for understanding what each list/category is *for*, not for current volumes. Check the live Google Tasks lists or Keep export for current counts.

## Google Tasks

| List | Items (2026-09-10) | Notes for Section 2 |
|---|---|---|
| To-Do Now | 21 | Highest priority. Surface if approaching deadline or referenced by an email. |
| Work | 10 | Client and project work. Cross-reference with incoming client emails. |
| Shopping List | 8 | Low priority. Only surface if an email references a purchase or price alert. |
| To-Do Later | 18 | Surface only if an email or calendar event makes an item suddenly urgent. |
| Plans & Goals | 20 | Medium-term goals. Relevant when the News/Intel section intersects with a goal. |
| Dreams | 19 | Long-term aspirations. Rarely relevant unless a major opportunity arises. |
| Daily Life Rules | 13 | **High value.** Standing personal operating rules - these seed `standing_context` and are injected into the Section 2 system prompt as standing preferences. |
| To Sort | 24 | Messy backlog. Never reference without explicit user instruction. |
| Uni | 7 | University deadlines/tasks. Same urgency treatment as Work. |
| RizinOS | 6 | Project-specific. Cross-reference with RizinOS-related news if tracked. |

**Default list for system-created tasks:** "To-Do Now" (decided 2026-09-10) - system items come from email deadlines and are time-sensitive, so they belong in the list checked daily, not a project backlog. Set as a list *title* in code and resolved to an id at call time by `resolveTaskList` (`src/ingest/google.ts`); `GOOGLE_TASKS_DEFAULT_LIST` overrides it without a deploy.

## Google Keep

~1,000 notes across these categories at initial harvest. The Context Builder (`context-builder/sources/`) is what actually indexes these now - check its current categorization logic there rather than assuming this table still matches verbatim, since the Context Builder has evolved since this was written.

| Category | Value | Original integration intent |
|---|---|---|
| Memories | High - specific information not to forget, may contain contact context or commitments | Migrate high-value ones to the system's `notes` table directly |
| Favorites | High - curated "best of" lists, directly relevant to entity importance scoring | Extract entities during indexing, boost matched entities' importance |
| Shower Ideas | Medium - project/product ideas ahead of their time | Index as `note_type = "idea"`, surface on related tech/market developments |
| Recommendations | Medium - products, services, travel destinations | Index entities, low-priority matches only |
| Learning Chinese | Low for briefing - personal learning notes | Index for entity extraction only, no active context injection |
| Full Travel Plans | Medium - future travel; a China trip plan should set the China-content calendar trigger | Parse dates if present |
| Thoughts | Low-medium - personal reflections, may overlap with diary | Index for topic signals only, never inject into prompts |
| Quotes | Low - saved quotes | Index attributed persons only |
| To-Do | Low - "mostly old stuff" | Should not be read as active tasks; user should migrate to Google Tasks |
| Random | Low - miscellaneous | Index for entity extraction, low injection priority |
| Archived | Very low - historical | Index once, don't refresh; deep entity lookups only |
