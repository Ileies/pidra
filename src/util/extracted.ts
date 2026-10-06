// Model-facing view of a stored extraction: `extracted_json` minus the fields only code reads.

/**
 * `extractedJson` without `entities_graph`, for any payload a model reads. The graph is Phase 6
 * bookkeeping (entity upserts) and is repeated on every claim row of a newsletter, so spreading
 * it into a prompt pays for the same graph once per claim. The stored row must keep it.
 */
export function forModel(extractedJson: unknown): object {
  const { entities_graph: _graph, ...rest } = (extractedJson ?? {}) as Record<string, unknown>;
  return rest;
}
