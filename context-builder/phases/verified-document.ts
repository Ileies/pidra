// The verification half of the synthesize phase: a patched document that breaks the `# 1.`-`# 5.`
// contract is rebuilt in full, and a full build that still breaks it throws. Pure of I/O so a test can drive it.
import { missingSections } from "../run-tracking";

export interface DocumentSteps {
  /** The update-mode patch of the previous document; null when there is nothing to patch. */
  patch: (() => Promise<string>) | null;
  /** The full build, used directly when `patch` is null and as the fallback for a rejected patch. */
  full: () => Promise<string>;
  /** Called once, before the fallback build, with the sections the patch lacked. */
  onPatchRejected: (missing: string[]) => Promise<void>;
}

/**
 * Returns a document that satisfies the `# 1.`-`# 5.` contract, or throws. A patch replaces the
 * document outright, so a reply that broke the contract would wipe the long-term context: it costs
 * one more call (the full build) instead. There is no fallback after the full build.
 */
export async function buildVerifiedDocument({ patch, full, onPatchRejected }: DocumentSteps): Promise<string> {
  let document: string;
  if (patch) {
    document = await patch();
    const missing = missingSections(document);
    if (missing.length > 0) {
      await onPatchRejected(missing);
      document = await full();
    }
  } else {
    document = await full();
  }

  const stillMissing = missingSections(document);
  if (stillMissing.length > 0) {
    throw new Error(`synthesised document is missing section(s) ${stillMissing.join(", ")}`);
  }
  return document;
}
