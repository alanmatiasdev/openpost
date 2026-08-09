<script lang="ts">
  import { resolve } from "$app/paths";
  import {
    formatPolicyEffectiveDate,
    legalPolicy,
  } from "@openpost/legal-policy";
  import { siteUrl } from "../_marketing";

  const effectiveDate = formatPolicyEffectiveDate(legalPolicy.privacy);
</script>

<svelte:head>
  <title>Privacy Policy - OpenPost</title>
  <meta
    name="description"
    content="How OpenPost collects, uses, shares, protects, exports, and deletes personal data for the hosted service."
  />
  <link rel="canonical" href={`${siteUrl}/privacy`} />
</svelte:head>

<header class="border-b py-14 sm:py-20">
  <div class="reading-shell">
    <p class="section-label">Legal</p>
    <h1
      class="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl"
    >
      Privacy Policy
    </h1>
    <p class="text-muted-foreground mt-5 text-lg leading-8">
      What the hosted OpenPost service processes, why it does so, and the
      choices available to you.
    </p>
    <div class="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
      <a
        href={resolve("/security")}
        class="focus-ring text-primary inline-flex min-h-11 items-center rounded-md"
        >Security details</a
      >
      <a
        href={resolve("/trust")}
        class="focus-ring text-primary inline-flex min-h-11 items-center rounded-md"
        >Managed service trust register</a
      >
    </div>
  </div>
</header>

<section class="section-pad">
  <article class="reading-shell prose dark:prose-invert">
    <p><strong>Effective date:</strong> {effectiveDate}</p>
    <p><strong>Policy version:</strong> {legalPolicy.privacy.version}</p>

    <h2>1. Who is responsible</h2>
    <p>
      The hosted OpenPost service at <a href="https://app.openpost.social"
        >app.openpost.social</a
      >
      is operated by Rodrigo Dias in Porto, Portugal. For privacy requests, email
      <a href="mailto:openpost@rgo.pt">openpost@rgo.pt</a>. OpenPost is the data
      controller for account and service data described in this policy.
    </p>
    <p>
      A self-hosted OpenPost installation is controlled by its operator. This
      policy does not govern an independent self-hosted installation; contact
      that operator about its practices.
    </p>

    <h2>2. Data we process</h2>
    <ul>
      <li>
        <strong>Account and workspace data:</strong> email address, display name,
        profile image, workspace and organization details, roles, invitations, and
        settings.
      </li>
      <li>
        <strong>Post data:</strong> drafts, scheduled and published content, media,
        account versions, OpenPost Image Editor designs and saved versions, explicitly
        cloud-saved OpenPost Video Editor projects, templates, brand settings, prompts,
        schedules, post status, and job history.
      </li>
      <li>
        <strong>Analytics data:</strong> account and post numbers, past results, update
        status, and safe platform error codes. Analytics records do not contain full
        platform replies, access tokens, post text, or direct messages.
      </li>
      <li>
        <strong>Website analytics data:</strong> anonymous page views, referrer URLs,
        browser, operating system, device type, country, and selected interaction
        events from openpost.social and docs.openpost.social. The website tracker
        does not use cookies, identify visitors, or track people across websites.
      </li>
      <li>
        <strong>Brand font records:</strong> custom WOFF2, TTF, or OTF files, family
        and style details, and the account and time associated with the required font-license
        acknowledgement.
      </li>
      <li>
        <strong>Connected-account data:</strong> social network, account ID, username,
        profile, supported features, X plan when relevant, granted access, and encrypted
        access or refresh tokens. OpenPost does not ask for your social-network password.
      </li>
      <li>
        <strong>Security data:</strong> password hashes, session identifiers, passkey
        public-key material, TOTP settings, API token details, IP address, browser
        details, sign-in and token activity, and password-reset records. OpenPost
        never stores a readable account password.
      </li>
      <li>
        <strong>Billing data:</strong> plan access, subscription, checkout, customer,
        transaction, and billing-status identifiers received from Paddle or the payment
        provider identified at checkout. OpenPost does not receive or store full payment-card
        details.
      </li>
      <li>
        <strong>Support and service data:</strong> messages you send, service logs,
        errors, request timing, usage counters, and abuse-prevention signals.
      </li>
    </ul>

    <h2>3. How we receive data</h2>
    <p>
      We receive data from you when you register, set up a workspace, upload
      content, connect a social network, buy a plan, or contact support. We also
      receive account and post data from the networks you connect, billing
      status from Paddle or the payment provider identified at checkout, and
      limited technical data when your browser or client uses the service.
    </p>
    <p>
      Camera access is requested only after you choose a camera action. A live
      preview stays in the browser and is not saved. A still photo is uploaded
      to the selected workspace only after you choose to use it. OpenPost Video
      Editor can optionally record a camera track; that recording and its local
      project stay in browser storage until you choose a cloud save, Media save,
      or post handoff.
    </p>

    <h2>4. Why we use data</h2>
    <ul>
      <li>
        Provide, secure, and support accounts, workspaces, publishing,
        analytics, and automation.
      </li>
      <li>Send content to the social networks and accounts you select.</li>
      <li>
        Draft image alternative text when automatic captioning is enabled.
      </li>
      <li>
        Process subscriptions, enforce plan limits, and keep billing records.
      </li>
      <li>
        Detect abuse, investigate failures, and protect users and the service.
      </li>
      <li>
        Comply with law, enforce the Terms of Service, and resolve disputes.
      </li>
      <li>Improve the service using technical logs and error data.</li>
      <li>
        Understand anonymous traffic and selected interactions on the marketing
        and documentation sites.
      </li>
    </ul>
    <p>
      For users in the European Economic Area, these uses rely on performing our
      contract with you, our legitimate interests in operating and securing the
      service, compliance with legal obligations, or consent where consent is
      required. You can withdraw consent without affecting earlier lawful
      processing.
    </p>

    <h2>5. When data is shared</h2>
    <p>We share data only as needed with:</p>
    <ul>
      <li>
        <strong>Social networks you choose</strong>, such as X, Mastodon
        servers, Bluesky, LinkedIn, Meta services, TikTok, or YouTube, to
        connect accounts and perform requested publishing actions. Their terms
        and privacy policies then apply.
      </li>
      <li>
        <strong>An identity provider you choose</strong>, such as Google, when
        you use that provider to sign in or link an identity.
      </li>
      <li>
        <strong>Hosting companies</strong> that run the app, database, media, email,
        network, analytics, and backups under their service terms.
      </li>
      <li>
        <strong>OpenRouter and selected AI model providers</strong>, when
        automatic image captioning is enabled, to process a 400-pixel JPEG
        thumbnail and up to 1,000 characters of the relevant draft or thread
        segment as untrusted context. OpenPost does not send the original image
        for this feature. Their service and privacy terms apply.
      </li>
      <li>
        <strong>Paddle and prior payment providers</strong> for checkout, subscriptions,
        tax, billing records, refunds, fraud prevention, and customer portals. Paddle
        acts as Merchant of Record for orders it processes.
      </li>
      <li>
        <strong>Stock-media services you search</strong> to return requested photo
        or video results and record provider-required selection or download events.
      </li>
      <li>
        <strong>The disclosed feedback recipient</strong> when you choose to send
        the in-app report, including its text, optional screenshot, and the diagnostics
        shown before submission.
      </li>
      <li>
        <strong>Authorities or other parties</strong> when reasonably necessary to
        comply with law, protect rights and safety, investigate abuse, or complete
        a business reorganization.
      </li>
    </ul>
    <p>
      OpenPost does not sell personal data, build advertising profiles, or share
      personal data for cross-context behavioral advertising.
    </p>
    <p>
      The dated <a href={resolve("/trust")}>managed service trust register</a>
      names current data locations, service providers, user-directed recipients, international-transfer
      facts, and the human production-access boundary.
    </p>

    <h2>6. Google and YouTube API data</h2>
    <p>
      If you connect YouTube, OpenPost uses Google API data only to provide the
      connection, video-publishing, and channel or video analytics features you
      request. That use and transfer comply with the
      <a
        href="https://developers.google.com/terms/api-services-user-data-policy"
        >Google API Services User Data Policy</a
      >, including its Limited Use requirements. OpenPost does not use Google
      user data for ads, credit decisions, or unrelated profiling.
    </p>
    <p>
      OpenPost uses YouTube API Services. Google's handling of information is
      described in the
      <a href="https://policies.google.com/privacy">Google Privacy Policy</a>.
    </p>
    <p>
      You can disconnect a YouTube account in OpenPost and revoke access from
      your
      <a href="https://security.google.com/settings/security/permissions"
        >Google account permissions</a
      >.
    </p>

    <h2>7. Retention and deletion</h2>
    <p>
      We keep account, post, and analytics data while your account is active and
      as needed to provide the service. Single-use reset tokens expire quickly
      and are invalidated after use. Operational and security records are kept
      only as long as needed for reliability, abuse prevention, legal
      obligations, and dispute handling.
    </p>
    <p>
      You can download an account export or request permanent deletion from
      account settings. Deletion can be delayed when you must first transfer
      shared ownership, cancel active billing, or preserve the last required
      instance administrator. Primary account and personal workspace data are
      removed when deletion completes. The managed service makes daily database
      and media recovery copies in root-restricted operator storage. Routine
      database dumps and changed or deleted media versions are pruned by a daily
      job after they become more than 14 days old. A copy can therefore remain
      until the next daily run. Operator-created repair or incident snapshots
      follow a separate review and are kept only while needed for recovery,
      security, legal duties, fraud prevention, or enforcing legal rights.
      OpenPost does not add a separate application-level encryption layer to
      each backup artifact.
    </p>

    <h2>8. Cookies and local storage</h2>
    <p>
      The application uses essential session and security cookies. It may use
      local browser storage for the selected workspace, server address,
      language, sound preference, composer return state, unsynced OpenPost Image
      Editor recovery copies, and local OpenPost Video Editor projects, sources,
      recordings, transcripts, analysis results, models, and exports. Clearing
      site data can remove local OpenPost Video Editor content.
    </p>
    <p>
      OpenPost Image Editor background removal runs in your browser with model
      and runtime files served by the OpenPost operator. Source pixels are not
      sent to a background-removal service. A result is uploaded to the selected
      workspace only when processing succeeds.
    </p>
    <p>
      The marketing and documentation sites use self-hosted, cookie-free Umami
      analytics to measure anonymous traffic and selected interactions. They do
      not use advertising trackers, identify visitors, or track people across
      websites. The hosted application does not load this website analytics
      tracker. The privacy-enhanced YouTube player is loaded only when you open
      the product demo; YouTube may then process device and playback data.
    </p>
    <p>
      OpenPost Video Editor live previews, optional screen, camera, and audio
      recording, editing, transcription, voice detection, framing analysis, and
      export run in the browser. Model files are downloaded only after the user
      starts the related tool. Local project data, recordings, sources, and
      exports are uploaded only when the user chooses a cloud save, Media save,
      or post handoff.
    </p>

    <h2>9. International transfers</h2>
    <p>
      Your selected social networks and some service providers may process data
      outside Portugal or the European Economic Area. When OpenPost controls a
      transfer and a safeguard is required, it must use an adequacy decision,
      contractual safeguards, or another lawful transfer method. The managed
      service trust register states the current provider-specific facts and any
      unresolved documentation gap. Publishing to a social network is also a
      transfer that you choose.
    </p>

    <h2>10. Your rights</h2>
    <p>
      Depending on where you live, you may have rights to access, correct,
      export, delete, restrict, or object to processing, and to withdraw
      consent. Use account settings for export and deletion or email <a
        href="mailto:openpost@rgo.pt">openpost@rgo.pt</a
      >. We may need to verify your identity before completing a request.
    </p>
    <p>
      You may also complain to your local data-protection authority. In
      Portugal, this is the
      <a href="https://www.cnpd.pt/"
        >Comissão Nacional de Proteção de Dados (CNPD)</a
      >.
    </p>

    <h2>11. Security</h2>
    <p>
      OpenPost uses encrypted social account tokens, password hashing, secure
      session cookies, limited tool tokens that you can remove, access controls,
      TOTP, passkeys, request limits, backups, and checks for unsafe software
      packages. No internet service can guarantee full security. Report a
      suspected security flaw to
      <a href="mailto:openpost+security@rgo.pt">openpost+security@rgo.pt</a>.
    </p>

    <h2>12. Children</h2>
    <p>
      The hosted service is not directed to anyone under 18. Do not create an
      account if you are under 18.
    </p>

    <h2>13. Changes and contact</h2>
    <p>
      We may update this policy when the service or legal requirements change.
      Material changes will be announced in the service or by email when
      appropriate, and the policy version and effective date will change.
      Corrections to spelling, formatting, or links that do not change meaning
      keep the same version. Questions and requests can be sent to
      <a href="mailto:openpost@rgo.pt">openpost@rgo.pt</a>.
    </p>
  </article>
</section>
