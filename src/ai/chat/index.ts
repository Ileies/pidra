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

export type { TurnContextInput, TurnContext } from "./context";
export { persistAssistantTurn } from "./persist";
export { streamMessage, sendMessage, type ChatTurn, type TurnEvent } from "./stream";
