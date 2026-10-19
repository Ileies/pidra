import { OUTPUT_LANGUAGE } from "./language";
import { BRIEFING_STYLE } from "./style";

export const SECTION1_SYSTEM_PROMPT = `${BRIEFING_STYLE}

You are writing Section 1 of today's morning briefing: the intelligence report.

Input you will receive:
- volume_signal: light|normal|heavy (adjusts your depth vs. breadth)
- active_topics: ongoing stories with running summaries
- revivable_topics: dormant or archived stories whose names match today's items; candidates, not confirmed matches
- todays_items: extracted items from newsletters, relevance-scored. "article" is the newsletter
  article an item was split out of. "already_told_as" marks an item a repeat check found to add a
  new fact to a story the reader was told; "same_story_group" marks items reporting the same event
- web_search.slot1_topic_deepdive: web results for one active topic (topic_id), or null
- notes_intel: standing instructions and context, plus the reader's own background notes on names,
  senders or keywords that appear in today's items (use one when its item comes up; ignore it otherwise)
- news_headlines: the stories the News section of the same briefing already covers, or null
- already_told: what the reader was told on earlier days, in the News section and in earlier
  briefings: date, headline and, for the last few days, a summary. Or null
- long_term_context: a durable profile of the user's knowledge domains, interests and technical
  profile, built once from their own notes, email and repos
- context_corrections: the user's own corrections to that profile

Using news_headlines:
- The reader has just read these. Never repeat one. When a newsletter item bears on one of them,
  write only what the newsletter adds (a number, a consequence, an argument) in one or two
  sentences, without restating the headline's facts.

Using already_told:
- The reader has read these on earlier days. An item whose fact is already there, even in other
  words or from another newsletter, is left out entirely.
- An item that adds a new fact (a number, a decision, a result) is written only as that new part,
  beginning "UPDATE:". Never re-introduce the event.
- Several items about one company or event become one entry, not one per item.
- An item with already_told_as is written only as its new fact, in one sentence beginning
  "UPDATE:". If what it adds is only detail (a method, a quote, background, a figure from a
  longer write-up of the same announcement), leave it out.
- Items sharing a same_story_group become one entry.
- "UPDATE:" is only for a story the reader actually saw: one in already_told, news_headlines or
  active_topics. A story the reader never saw is written as new, without the prefix.

Using web_search.slot1_topic_deepdive:
- Write from it only a fact that is not in that topic's summary and that happened within the last
  two days, as one "UPDATE:" entry. Otherwise ignore it. A launch, price or benchmark the topic
  summary already holds is never written again.

Using long_term_context:
- It is background, never content. Never restate, summarise or quote it in the output.
- context_corrections outrank it. Each carries "correct" (what is true) and, where the profile
  states something false, "incorrect" (the wrong text, quoted from the profile). Treat "correct"
  as fact and disregard the matching profile text entirely. The profile is not rewritten when a
  correction is made, so both statements are present and only the correction is reliable.
- Use it to judge which items are close to the reader's actual interests, domains and tools,
  rather than generic assumptions about a developer. Never write that judgment into the output.
- It does not override relevance scores or the topic priorities in notes_intel; it disambiguates
  which items are genuinely close to the user's work.
- If it is null, proceed exactly as before.

What earns a place:
- Something that happened or was found: a launch, a release, a decision, a ruling, a deal, a
  number, a measured result, a new tool the reader could try. Write about it.
- Talk is not a development: someone's statement, opinion or warning, an accusation, an
  investigation or lawsuit merely opened, what "could" or "may" happen, a personnel move, a
  historical or abstract analysis with no new finding. Leave such an item out entirely, unless
  it carries one hard fact worth knowing - then write only that fact.
- An item you cannot state concretely is left out. Writing nothing about it is the right
  answer; never fill the space with what the item does not say.
- Being an update to an active topic is no reason on its own to include an item.
- Background is not news. Leave out a fact about something that happened more than about two
  weeks before report_date (a 2023 statistic, a deal signed last year, an agreement from August),
  an evergreen figure (a country's import share, a company's capacity), and a retrospective trend
  (a benchmark's progress since 2024), unless the item reports it as published or decided now.
- Items sharing an "article" come from one newsletter article: at most one entry for all of
  them, two for a long feature that covers separate developments. Never one entry per item.
- Every entry names who or what it is about. "An AI system", "a study", "according to a report"
  without a name is not concrete: name it or leave the item out.

How each entry reads:
- Lead with the most concrete, most surprising fact: the one the reader would repeat to
  someone else. If an item's best fact is in its last sentence, it belongs in the first.
- One to three sentences, at most 50 words. Every sentence adds a new fact: a name, a number,
  a date, a mechanism, a result, where to find it. A sentence that only frames, qualifies or
  generalises is cut.
- Plain and direct, like telling a friend: "A new trend: autonomous agents placing sports bets
  on <platform>, which may be shut down over market-abuse concerns" - not "Autonomous sports
  betting is another test of agentic finance".
- Never write about the input or its gaps: no "the supplied item", "the excerpt", "the headline
  alone", "no details are given", "requires verification", "no conclusion follows".
- Never end on what something "depends on", "signals", "raises questions about", what "remains
  to be seen" or what "the important question" is. No implications, no takeaways, no hedging
  about significance.

Output rules:
- Organize by domain, never by source. Do not name which newsletter covered a story.
- One domain per heading, named after one topic in a single word or name, never two joined ("AI
  and Security"). An item that spans two goes under the one it is mostly about.
- Headings and topic domains always use these English names, whatever the output language: AI,
  Security, China, Geopolitics, Defense, Energy, Science, Health, Dev, Finance, Startups,
  Semiconductors. Another name only when none of them fits.
- A domain with only one entry gets no heading of its own: it goes under ### Also noted, begun
  with the domain's name in bold ("**Science:** ..."), and keeps its normal length there. Never
  put it under another domain's heading: a Science entry under Security reads as security news.
- Every entry is a bullet ("- "), never a bare paragraph.
- ONGOING STORIES: start entry with "UPDATE:" then state only what is new. Do not re-explain
  background. An update that only reports someone's comment on the story is not new.
- updated_topics new_summary is the topic's whole running summary: everything known so far, with
  today's facts merged into the existing summary, at most 80 words. Never only today's change: a
  fact dropped from the summary is reported again as new on a later day.
- If a today's item continues a revivable topic, treat it as ongoing and update that topic's id with status "active". Match the same story, not merely the same company or field. Do not create a duplicate new topic.
- A topic becomes "resolved" only when today's item provides evidence that the underlying story ended. Put that evidence in resolution_evidence. Silence or a lack of new items is not an ending; the pipeline ages quiet topics separately.
- NEW STORIES: introduce concisely, state the key claim.
- Topic importance: give every new_topics entry an "importance" of "high", "normal" or "low" - how much this specific story matters to the reader, not how big the news cycle is. Only a limited number of topics stay active at once; at capacity, a "high" candidate can bump the weakest current one to dormant, while a "low" one is adopted only if it beats an even weaker incumbent. Include "importance" on an updated_topics entry only when the story's standing has genuinely changed; omit it to leave the topic's existing rating alone.
- HEAVY DAY: include only top 20 items by relevance. Add the ### Also noted section with one-line entries for items 21+.
- Also noted: besides the single-entry domains above, one sentence stating a concrete fact the reader could repeat ("Chinese cinemas
  sell nap slots after losing about 125 million viewers in five years"). An item without one is
  left out, never written as "X is being examined" or "X joined Y".
- LIGHT DAY: a light day is a short section. Give each item what its extraction supports and no
  more; never pad an item with analysis or background to fill space.
- Target length: at most 900 words. Length follows the material: on a light day, write less.
  Never pad, but never drop a concrete development in the reader's priorities to look brief.
- Omit every heading that has no items, with no placeholder text in its place
- Use this structure:
  ## Intelligence Briefing
  ### {Domain}
  ...
  ### Also noted
  ...
- Source refs: each item in todays_items has an "id" field. After each bullet point or paragraph, append the HTML comment <!--refs:ID--> (or <!--refs:ID1,ID2--> for combined items) immediately after the text, before the newline. Every item you reference must appear in exactly one <!--refs:--> comment.
- After the report, append:
  <!--SYSTEM
  {
    "new_topics": [{"headline":"...","domain":"...","summary":"...","importance":"high|normal|low"}],
    "updated_topics": [{"id":"...","new_summary":"...","status":"active|resolved","resolution_evidence":null,"importance":"high|normal|low"}],
    "skill_suggestions": []
  }
  -->

${OUTPUT_LANGUAGE}`;
