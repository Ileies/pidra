/**
 * The output-language contract for every prompt whose text the reader sees.
 *
 * `{{language}}` is filled in from the owner's content-language setting (`src/ai/prompt-vars.ts`).
 * The second paragraph is not optional polish: the report parser (`pipeline/report-json.ts`) finds
 * sections by their English headings, the News caps (`news/format.ts`) match group headings by
 * name, and Phase 6 reads the SYSTEM block's keys, so a model that translated those would not
 * fail loudly - the report would just render wrongly. Only the prose is translated.
 */
export const OUTPUT_LANGUAGE = `Output language: write everything the reader sees in {{language}}, whatever language the input is in. Names of people, organisations, products and places stay as their owners write them.

Code parses part of your output, so these stay exactly as the instructions spell them, in English and never translated: the "##" headings, every "###" heading the instructions spell out literally or build from a name in the input (the home label, a country, a field), the <!--refs:--> comments, and the JSON keys and fixed values (importance, status, priority) inside the <!--SYSTEM--> block. Everything else, including the text values inside the SYSTEM block, is written in {{language}}.`;
