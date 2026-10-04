/**
 * A submitted form with the two reads every action needs. `text` is the trimmed value of a field
 * ("" when it is absent), `flag` is a checkbox or hidden `true`/`false` field.
 */
export async function readForm(request: Request) {
  const data = await request.formData();
  return {
    data,
    text(name: string): string {
      const value = data.get(name);
      return typeof value === "string" ? value.trim() : "";
    },
    flag(name: string): boolean {
      return data.get(name) === "true";
    },
  };
}
