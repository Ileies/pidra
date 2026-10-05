/**
 * Pure classification of what became of one candidate item in a completed briefing, for the Jev
 * baseline (`scripts/jev-baseline.ts`). Reads the gate and handoff verdicts persisted on
 * `extractions` (`gate_passed`, `synthesis_handoff`, `included_in_report`); touches no DB itself.
 */
export type CandidateOutcome =
  | "not_extracted"
  | "extraction_failed"
  | "not_gated"
  | "gate_rejected"
  | "outside_synthesis_capacity"
  | "handoff_unrecorded"
  | "sent_omitted"
  | "cited";

export interface CandidateVerdict {
  sourceType: "newsletter" | "web_news";
  aiFailed: boolean | null;
  gatePassed: boolean | null;
  synthesisHandoff: string | null;
  includedInReport: boolean | null;
}

export function candidateOutcome(candidate: CandidateVerdict | null): CandidateOutcome {
  if (!candidate) return "not_extracted";
  if (candidate.aiFailed) return "extraction_failed";
  if (candidate.gatePassed === null) return "not_gated";
  if (!candidate.gatePassed) return "gate_rejected";
  if (candidate.synthesisHandoff === "outside_synthesis_capacity") return "outside_synthesis_capacity";
  if (candidate.synthesisHandoff === "sent") return candidate.includedInReport ? "cited" : "sent_omitted";
  // Every gate-passed news story goes to the editor, without a Section 1 handoff marker.
  if (candidate.sourceType === "web_news") return candidate.includedInReport ? "cited" : "sent_omitted";
  // Older runs have no handoff marker. A citation still proves the item was seen.
  return candidate.includedInReport ? "cited" : "handoff_unrecorded";
}

export interface SourceFailure {
  step: string;
  source: string;
  error: string;
}

/** Phase 1 and news failures are source gaps, never ranking errors. */
export function sourceFailures(errors: { step: string; error: string }[]): SourceFailure[] {
  return errors
    .filter((error) => error.step === "phase1" || error.step === "news")
    .map(({ step, error }) => {
      const namedSource = error.match(/^((?:imap|news):[^:]+): (.*)$/);
      if (namedSource) return { step, source: namedSource[1], error: namedSource[2] };
      const colon = error.indexOf(": ");
      return colon < 0
        ? { step, source: step, error }
        : { step, source: error.slice(0, colon), error: error.slice(colon + 2) };
    });
}
