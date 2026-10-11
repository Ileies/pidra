// Model-facing view of a stored extraction: `extracted_json` minus the fields only code reads.

/**
 * `extractedJson` without `entities_graph`, for any payload a model reads. Rows stored before the
 * entities table was removed carry that field on every claim of a newsletter, so spreading it into
 * a prompt would pay for the same graph once per claim. The stored row is left as it is.
 */
export function forModel(extractedJson: unknown): object {
  const { entities_graph: _graph, ...rest } = (extractedJson ?? {}) as Record<string, unknown>;
  return rest;
}
