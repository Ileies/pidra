<script lang="ts">
  import Page from "#lib/components/Page.svelte";
</script>

<Page title="Privacy Policy" size="read" class="space-y-7 text-sm leading-7 text-surface-300">
  <header class="space-y-3">
    <h1 class="text-2xl font-bold text-surface-50">Privacy Policy</h1>
    <p>Effective September 25, 2026</p>
    <p>
      PIDRA is a personal information assistant. Its purpose is to collect, connect, analyze, and
      retain information from the sources its operator connects, then use that information to
      produce briefings, context, search results, reminders, and assistant responses. This can
      involve substantial amounts of personal and sensitive information about the user and other
      people mentioned in the connected sources.
    </p>
  </header>

  <section class="space-y-2">
    <h2 class="text-lg font-semibold text-surface-50">Who operates PIDRA</h2>
    <p>
      PIDRA is a privately operated application. The person who configured your access and
      connected the data sources is the operator and the contact for questions, access requests,
      and deletion requests. If you do not know who that is, do not connect an account or provide
      data until the operator identifies themselves to you.
    </p>
  </section>

  <section class="space-y-2">
    <h2 class="text-lg font-semibold text-surface-50">Data we process</h2>
    <p>Depending on what the operator has connected and enabled, PIDRA may process:</p>
    <ul class="list-disc space-y-1 pl-5">
      <li>Email messages and metadata from configured mailboxes, including senders, recipients, subjects, dates, and message bodies.</li>
      <li>Google Calendar event details and Google Tasks lists, tasks, due dates, and completion status.</li>
      <li>Google Keep notes through a separate integration, GitHub activity, SMS messages, news feeds, and web search results.</li>
      <li>Notes, corrections, preferences, questions and answers, feedback, chat messages, and actions entered in PIDRA.</li>
      <li>Derived material such as summaries, reports, extracted facts, entity and contact records, source scores, and audit logs.</li>
      <li>Operational data such as access tokens, connection settings, request and error logs, device push subscriptions, and local offline copies.</li>
    </ul>
    <p>
      Source content can include private correspondence, relationships, finances, health, beliefs,
      location, and other sensitive details. PIDRA may process information about third parties
      contained in a user's connected sources. The amount processed can grow as a source receives
      new data or the operator enables another documented integration.
    </p>
  </section>

  <section class="space-y-2">
    <h2 class="text-lg font-semibold text-surface-50">Google data and permissions</h2>
    <p>
      With Google authorization, PIDRA reads calendar events and task lists to prepare briefings,
      track commitments, and answer user requests. At the user's request, its tools can create
      calendar events and create or complete tasks. The current OAuth permissions are Google
      Calendar events and Google Tasks. Email is fetched from separately configured mailboxes,
      not through this Google OAuth grant. Google Keep uses a separate connection.
    </p>
    <p>
      Google data may be stored in PIDRA's database and reports, combined with other connected
      information, and sent as needed to an AI provider to produce the features above. PIDRA does
      not sell Google user data or use it for advertising or to train a general AI model. Its use
      of information received from Google APIs follows the Google API Services User Data Policy,
      including its Limited Use requirements.
    </p>
  </section>

  <section class="space-y-2">
    <h2 class="text-lg font-semibold text-surface-50">How data is used and shared</h2>
    <p>
      PIDRA uses connected information to ingest and organize material, generate daily reports and
      long-term context, search and retrieve records, personalize responses, detect errors, keep
      audit history, and perform actions the user requests through enabled tools. Automated
      extraction and synthesis may infer interests, relationships, priorities, or tasks from the
      material. These outputs can be incomplete or wrong.
    </p>
    <p>
      Data is stored on infrastructure controlled by the operator. Depending on the feature,
      content or summaries may be sent to OpenAI for extraction, synthesis, or chat, to a web
      search provider for queries, to Google when reading or writing Calendar and Tasks, and to
      push delivery services for notifications. These providers may process data in other
      countries under their own terms and safeguards. PIDRA does not publish personal reports or
      sell personal data. Access is intended for the operator and people they explicitly allow.
    </p>
    <p>
      Connected credentials are used to access the corresponding source. Keep notes labelled
      <span class="font-medium text-surface-100">Credentials</span> are filtered before the Context
      Builder sends note content to the AI provider. This filter does not mean all material from
      every other source is free of secrets; users should avoid connecting sources containing
      information they do not want processed.
    </p>
  </section>

  <section class="space-y-2">
    <h2 class="text-lg font-semibold text-surface-50">Retention and control</h2>
    <p>
      PIDRA keeps source records, derived context, reports, corrections, and logs for continuity
      and auditability. There is no single automatic deletion period for all categories. Removing
      a source stops new collection from it but does not necessarily erase existing reports,
      derived records, backups, or provider copies. Local offline copies can remain on devices
      until their app data is cleared. Ask the operator for access, correction, deletion, or an
      explanation of what remains. You can revoke Google's authorization in your Google account;
      this stops future Google API access but does not itself delete data already stored in PIDRA.
    </p>
    <p>
      Where applicable law gives you rights to access, rectify, erase, restrict, object, port
      data, withdraw consent, or complain to a supervisory authority, those rights remain
      available. Using PIDRA does not waive them. Some records may need to be retained where
      required or permitted by law.
    </p>
  </section>

  <section class="space-y-2">
    <h2 class="text-lg font-semibold text-surface-50">Changes to this policy</h2>
    <p>
      The operator may update this policy as PIDRA develops. A new integration, recipient, or
      materially different use of Google data requires an updated disclosure and, where required,
      renewed authorization or consent before that use begins. The effective date above changes
      when this policy is updated.
    </p>
  </section>

  <p class="border-t border-surface-700 pt-5">See also <a class="text-primary-300 underline" href="/terms">Terms of Service</a>.</p>
</Page>
