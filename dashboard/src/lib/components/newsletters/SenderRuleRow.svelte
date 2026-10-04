<script lang="ts">
  /**
   * One editable sender rule. `dirty` starts false and is never seeded from the row itself - it
   * only ever flips true on an actual edit and false again once a save lands - so Save stays
   * disabled until something in this row has actually changed.
   */
  import { enhance } from "$app/forms";
  import Card from "#lib/components/Card.svelte";
  import ConfirmButton from "#lib/components/ConfirmButton.svelte";
  import Field from "#lib/components/Field.svelte";
  import type { SenderRuleRow } from "#lib/server/newsletters.js";

  interface Props {
    rule: SenderRuleRow;
  }

  let { rule }: Props = $props();

  let dirty = $state(false);
</script>

<!-- One line on desktop, Save and Remove included: the grid lives on the `<li>` so the delete
     form (a sibling of the update form, since a form can't nest another) shares its row instead
     of dropping onto one of its own below (M14, 2026-10-01). -->
<Card as="li" class="p-3 grid grid-cols-1 sm:grid-cols-[auto_1fr_1fr_auto_auto] gap-3 sm:items-end">
  <form
    method="POST"
    action="?/updateRule"
    oninput={() => (dirty = true)}
    use:enhance={() => async ({ result, update }) => {
      if (result.type === "success") dirty = false;
      await update();
    }}
    class="contents"
  >
    <input type="hidden" name="id" value={rule.id} />
    <Field name="matchKind" label="Match" dense as="select" value={rule.matchKind}>
      <option value="domain">Domain</option>
      <option value="address">Address</option>
    </Field>
    <Field name="pattern" label="Sender" dense mono required value={rule.pattern} inputClass="min-w-0" />
    <Field name="sourceName" label="Source" dense maxlength="120" value={rule.sourceName} placeholder="Use display name" inputClass="min-w-0" />
    <button
      disabled={!dirty}
      class="tap rounded border border-surface-500 px-3 py-2 sm:py-1.5 text-base sm:text-sm text-surface-300 hover:border-primary-500 hover:text-primary-300 transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-surface-500 disabled:hover:text-surface-300"
    >Save</button>
  </form>
  <ConfirmButton label="Remove rule" action="?/deleteRule" fields={{ id: rule.id }} size="input" />
</Card>
