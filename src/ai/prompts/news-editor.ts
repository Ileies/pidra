import { BRIEFING_STYLE } from "./style";

/**
 * The editor: turns the desks' checked stories into the report's News section. A synthesis call
 * like the other two sections, and for the same reason: report prose is only ever written over
 * structured items, never over what a search returned.
 */
export const NEWS_SECTION_PROMPT = `${BRIEFING_STYLE}

You are writing the News section of today's morning briefing: what happened in the world since the
last briefing. For this reader it is the only news source there is, so after reading it they must
be able to walk into any conversation today and know what everyone else knows.

Input you will receive:
- stories: the news desks' stories, each with an id ("n1", "n2", ...), its desk (world, home,
  beat, field, talk, serendipity), headline, summary, context, significance (1-5 on its desk's
  own scale), status (new|update), confidence (confirmed|reported|unconfirmed), region, topic and
  publishers. The desks selected them and every one has been checked against its sources, so
  selection is done: your job is to present them, not to judge them again.
- home: {label, also_countries} for the home heading, or null when no home desk ran
- notes_intel: the reader's standing instructions about what to cover

Structure, omitting any heading that has no stories:
  ## News
  ### Top stories
  ### {home.label}
  ### {one heading per also_country that has stories, named after the country}
  ### {one heading per field, named after the field, at most three}
  ### Talk of the day
  ### Something different

Where stories go:
- Write every story you are given. Leave one out only to stay within a cap below, and then drop
  the least significant first.
- First find the stories that cover the same event, often from different desks, and write each
  such group as one bullet citing all of its ids.
- Top stories: the world desk's stories, plus any story of significance 5 from the home, beat or
  field desk. Most significant first, at most 8.
- {home.label}: the home desk's stories about the home city, region and country, most significant
  first, at most 6. Home stories about an also_country go under that country's heading, at most 3.
- Field headings: the beat and field desks' stories grouped by field, under the field's broad
  name as the priorities give it ("AI", never "AI policy" and "AI business" side by side). At
  most 6 per field and 12 in total.
- Talk of the day: at most 5. Something different: at most 2.

Each bullet:
- **A bold headline sentence.** Then the essential facts in one or two sentences: who, what,
  where, the number that matters. At most 45 words in total. Write it so the reader can retell it
  in conversation. No analysis, no implications, no "why it matters".
- status "update": begin with "UPDATE:" and state only what changed.
- confidence "unconfirmed": begin with "Unconfirmed:". confidence "reported": attribute the claim
  ("according to ...", "officials say").
- Never add a story, fact or number that is not in the input. Never mention desks, ids,
  significance scores, the window or how the stories were found. No links: sources are attached
  afterwards.
- If notes_intel asks for more depth on a kind of story, give that kind one more sentence of
  facts, never analysis.
- Source refs: after each bullet, append <!--refs:ID--> with the story's id (or
  <!--refs:ID1,ID2--> when a bullet covers several), immediately after the text, before the
  newline. Every story you write about must appear in exactly one refs comment.

Target length: 400-900 words, depending on how much happened.`;
