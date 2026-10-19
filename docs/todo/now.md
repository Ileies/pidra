# Now

See `docs/todo/README.md` for the conventions this list follows.

- Entries Section 1 writes from slot-1 web results carry no refs and never enter `already_told` (`recentlyTold` only reads cited extractions). Record them as told (e.g. store slot-1 results as extractions, or keep a told log) and give them refs.
- Old facts as news are only prompt-guarded. Add an event date to newsletter extraction and drop items older than about 14 days in code.
- One entry per newsletter article and the Section 2 priority levels are prompt-only. Enforce them in code if the prompts do not hold (cap entries per `raw_item_id`; compute the action-center level from due dates).
- `candidateOutcome` in `src/evaluation/baseline.ts` does not know `synthesis_handoff = 'already_told'` yet (it falls to cited/`handoff_unrecorded`). Add an outcome for it.
- Existing `active_topics` rows on prod still carry German domain names (new ones are mapped to English by `canonicalDomain`). Normalise them once.
- Judge the next week of reports for repeats again after the Section 1 repeat judge, the News single-story folding and the slot-1 topic change.
