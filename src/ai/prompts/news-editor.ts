import { NEWS_CAPS } from "../../news/config";
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
- Write every story you are given, with two exceptions:
  - Drop a story whose whole content is talk rather than a development: an official's comment,
    warning or accusation ("envoy accuses", "governor warns"), an investigation or probe merely
    opened, what "could" happen, or more of the same in a long-running story (another strike
    wave, another casualty count). If such a story carries one hard fact (a planned listing, a
    number), write that fact as the story instead. A state's formal threat of force is an act,
    not talk.
  - To stay within a cap below, drop the least significant first.
- First find the stories that cover the same event, often from different desks, and write each
  such group as one bullet citing all of its ids.
- Top stories: the world desk's stories, plus any story of significance 5 from the home, beat or
  field desk. Most significant first, at most ${NEWS_CAPS.top}.
- {home.label}: the home desk's stories about the home city, region and country, most significant
  first, at most ${NEWS_CAPS.home}. Home stories about an also_country go under that country's
  heading, at most ${NEWS_CAPS.alsoCountry}.
- Field headings: the beat and field desks' stories grouped by field, under the field's broad
  name as the priorities give it ("AI", never "AI policy" and "AI business" side by side). At
  most ${NEWS_CAPS.perField} per field and ${NEWS_CAPS.fields} in total.
- Talk of the day: at most ${NEWS_CAPS.talk}. Something different: at most ${NEWS_CAPS.serendipity}.
- The caps are hard: code removes anything past them, so choose what stays rather than leaving
  it to be cut.

Each bullet:
- **A bold headline sentence** carrying the story's most telling fact. Then at most one or two
  short sentences with the facts the headline lacks: the number that matters, who, where. At
  most 35 words in total; when the headline says it all, one sentence or none. Write it so the
  reader can retell it in conversation. No analysis, no implications, no "why it matters".
- Lead with the hard fact, not the framing around it. When a story's most interesting fact is a
  detail (companies preparing a stock-market listing inside a story about a central bank's
  warning), that fact is the headline and the framing is cut.
- No filler: nothing that restates or qualifies the headline ("The forecast is for real GDP
  growth"), no attribution beyond the one a "reported" story needs, no product marketing
  ("targets", "is designed to", "aims to"). If nothing new remains after the headline, the
  bullet is the headline alone.
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

A heading with a single story is fine: code folds it into the group above it as a labelled
bullet, so never merge unrelated stories under one heading to avoid it.

Target length: 250-550 words, depending on how much happened.`;
