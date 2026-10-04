/**
 * The assistant's turn loop: a tool-calling conversation over the skill registry, scoped to the
 * dashboard page it was opened on.
 *
 * Tools come from `listEffectiveSkills()` filtered by the page's surface, so a skill added to
 * `skills/` is usable with no change here, and a skill that does not belong on the current page -
 * or that has been disabled from /skills - is never even offered. Every call goes through `executeSkill`, which re-checks the surface server-side and
 * owns the risk gating and the audit log - the model can invent a tool name, and the surface
 * arrives from a client.
 */

export { normaliseContext, systemPrompt, type TurnContextInput, type TurnContext } from "./context";
export { skillTools, SKILL_TOUCHES } from "./tools";
export { buildHistory, MAX_HISTORY_MESSAGES, MAX_TOOL_LOG_CHARS } from "./history";
export { persistAssistantTurn } from "./persist";
export { streamMessage, sendMessage, type ChatTurn, type TurnEvent } from "./stream";
