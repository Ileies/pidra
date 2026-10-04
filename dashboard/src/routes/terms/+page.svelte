<script lang="ts">
  import LegalPage from "#lib/components/LegalPage.svelte";
  import LegalSection from "#lib/components/LegalSection.svelte";
</script>

<LegalPage title="Terms of Service" effective="September 25, 2026">
  {#snippet intro()}
    PIDRA is a privately operated personal information assistant. By choosing to connect a
    source or use the application, you authorize the operator to process the information needed
    for the features described in the <a class="text-primary-300 underline" href="/privacy">Privacy Policy</a>,
    subject to applicable law and the permissions you grant to each provider.
  {/snippet}

  <LegalSection title="What the service does">
    <p>
      PIDRA imports and analyzes connected information, creates reports and context, and offers
      search, chat, reminders, and tools that can write to connected services when requested.
      Connected sources can contain extensive private information. You decide whether to connect
      an account and may stop using PIDRA or revoke an integration's access at any time.
    </p>
  </LegalSection>

  <LegalSection title="Your responsibilities">
    <p>
      Connect only accounts you are authorized to use. Consider the rights and expectations of
      other people whose information appears in your mail, calendar, messages, or notes. Protect
      your devices and credentials, review actions before requesting them, and verify important
      facts independently. Do not use PIDRA for unlawful access or to violate another service's
      terms.
    </p>
  </LegalSection>

  <LegalSection title="Automated output and availability">
    <p>
      Summaries, classifications, answers, and suggested actions are generated automatically and
      can be inaccurate, incomplete, delayed, or unavailable. PIDRA is provided as available.
      Do not rely on it as the sole source for medical, legal, financial, safety, or time critical
      decisions. Connected providers can change or withdraw access, and the operator may change,
      suspend, or discontinue features.
    </p>
  </LegalSection>

  <LegalSection title="Data and rights">
    <p>
      You keep whatever rights you have in your content. You permit PIDRA to access, store,
      transform, and transmit it only as needed to provide the disclosed features and requested
      actions. This permission does not transfer ownership of your data and does not waive privacy
      or other rights that applicable law does not allow you to waive. Revoking a connection or
      stopping use does not automatically erase historical reports or records; see the
      <a class="text-primary-300 underline" href="/privacy">Privacy Policy</a> for retention and requests.
    </p>
  </LegalSection>

  <LegalSection title="Changes">
    <p>
      These terms may change as the service evolves. Material changes will be presented before
      they apply where required by law. Continued use after notice of an applicable change means
      acceptance only to the extent the law permits. New uses of Google data may require a
      separate disclosure and authorization.
    </p>
  </LegalSection>
</LegalPage>
