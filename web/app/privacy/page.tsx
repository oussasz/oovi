import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, Ph } from "@/components/LegalPage";
import { COMPANY_NAME, CONTACT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      summary={
        <p>
          <b>The short version:</b> your chats, files and API keys are saved on your computer. Your setup (bots, groups,
          skills, routines, settings and what your bots learned about you) is also kept, encrypted, with your oovi account
          so it follows you to your other computers. Cloud sync is optional and off unless you turn it on: then your
          chats (text) and your connectors’ sign-ins are also kept, encrypted, on our server, so you can use them on
          your phone and your bots can do some tasks while your computer is off. Your own AI API keys never leave your
          computer. If you
          use theOovi, our built-in model, each request passes through our server to our AI provider to be answered; we
          don’t store or read it, and we keep only numbers (how many credits and tokens it used). With your own API key,
          requests go straight from your computer to your provider. Your oovi account stores what we need to sign you in
          and run your credits, plus crash reports, usage numbers and anything you choose to send us (feedback, a pilot
          request). If you connect Telegram, your Telegram messages to your bot pass through our server until oovi on your
          computer collects them. You can delete your account at any time.
        </p>
      }
    >
      <h2>1. Who is responsible</h2>
      <p>
        <Ph>{COMPANY_NAME}</Ph> (“oovi”, “we”, “us”) is responsible for the personal data described in this policy.
        You can reach us at <Ph>{CONTACT_EMAIL}</Ph>.
      </p>

      <h2>2. What stays on your device</h2>
      <p>
        The oovi App is designed to keep your work local. The following is stored only on your own computer (unless
        you turn on cloud sync, section 3, which then copies your chats and connector sign-ins as described there):
      </p>
      <ul>
        <li>your chats, prompts and files (including what your bots make in a chat);</li>
        <li>your AI provider API keys, which are stored encrypted;</li>
        <li>results and content your bots produce.</li>
      </ul>
      <p>
        <b>Your setup, on every computer.</b> So that your oovi is the same on every computer you sign in on, a copy of
        your setup is kept with your account: your bots (their names, roles, instructions and looks), your groups (who
        is in them, not their messages), skills, routines, the connectors you added (without their keys or sign-ins),
        a few settings (such as the language and approvals), and what your bots learned about you (your profile,
        notes and lessons). It is stored compressed and encrypted, used only to bring your setup to your computers,
        and deleted with your account. Your chats, files, API keys and connector keys are never part of it.
      </p>
      <p>
        <b>Telegram.</b> If you connect a Telegram bot to oovi, Telegram sends the messages for that bot to our server,
        which keeps each one, encrypted, only until oovi on your computer collects it (24 hours at most). When your
        computer is off or oovi is closed, our server answers right away that you need to open oovi to continue. To do
        this, and so that every computer you sign in on can use the same bot, our server keeps your bot’s token
        (encrypted), the chats your bot answers and your language; they are deleted when you disconnect Telegram in
        oovi (on any of your computers) or delete your account. oovi’s answers go from your computer straight to
        Telegram.
      </p>
      <p>
        When your bots use <b>your own API key</b>, requests go directly from your device to the AI provider you chose.
        That provider processes your data under its own privacy policy and terms, so please review them. Likewise,
        websites your bots visit receive data under their own policies.
      </p>
      <p>
        When a bot looks for businesses or places in an area, the App asks OpenStreetMap’s search service
        (Nominatim, or Photon if that one has no answer) for the outline of the area, directly from your device. The
        question (that outline and the kind of place asked for, never your chats or files) then goes to our server,
        which reads Overture Maps’ public data and sends back the matching places; we keep only the usual technical
        logs. If our server can’t answer, the App reads that public data itself. When a bot looks for scientific
        publications, the App asks the public catalogues Crossref, Europe PMC and arXiv directly, with the topic only.
        These services receive the request and your internet address, as any website does.
      </p>
      <p>
        When your bots use <b>theOovi</b>, the model included with your oovi account, each request (the messages, files
        and tool results your bots send to the model) passes through our server to our AI provider, Anthropic, which
        answers it. Our server only checks your credits and forwards the request: we don’t store, log or read its
        content. Anthropic processes it on our behalf under its commercial terms for API customers. We record only
        numbers about each request: how many tokens it used, what it cost, how many credits it used, and whether it
        succeeded.
      </p>

      <h2>3. Optional cloud sync (off unless you turn it on)</h2>
      <p>
        Cloud sync is a choice. It is off until you turn it on in the App (Settings &gt; Sync, or the question the App
        asks you once). It is the same for free and paid accounts.
      </p>
      <p>
        <b>What is uploaded when it is on.</b>
      </p>
      <ul>
        <li>
          The text of your chats with your bots and groups (messages, your bots’ answers and the steps they took), so
          they are the same on your computers and your phone. Old chats are uploaded when you turn sync on. Files you
          attach or your bots make are not uploaded yet: the phone shows their name and that they are on your computer.
        </li>
        <li>
          Each bot can stay “on this computer only”: its chats are never uploaded. A group chat is uploaded only if
          every bot in it is a cloud bot.
        </li>
        <li>
          Your connectors’ settings and sign-ins (for example the access that lets your bots read your email or your
          calendar), and keys you type for a connector, so your phone and our server can use them. When you sign in to
          a connector from your phone, the service sends you back to our website, which stores that sign-in the same
          way.
        </li>
        <li>
          Messages and answers you send from your phone (a new message, an approval, Stop), until your computer or our
          server has handled them.
        </li>
        <li>
          Which of your devices use sync and when each was last seen (a random device id and its kind: computer, phone
          or our server). No device name, no location.
        </li>
      </ul>
      <p>
        <b>Never uploaded:</b> your own AI provider API keys (for example OpenAI, Anthropic or Gemini keys). They stay
        on your computer, and our server never uses them. On the phone and on our server, only theOovi answers, with
        your theOovi credits.
      </p>
      <p>
        <b>How it is kept.</b> Everything above is stored compressed and encrypted in our database. The encryption key
        is kept apart from the database, in our server’s settings. Each account has a size limit (100 MB of compressed
        chats); past it, new chats stay on your computer and the App tells you.
      </p>
      <p>
        <b>Our server can read it, and when it does.</b> So that your phone works and some tasks can run while your
        computer is off, our server can open what you synced: to show your chats on your phone, and to run a task you
        or a routine asked for (a message sent from your phone, a routine marked to run in the cloud) using your
        connectors’ sign-ins, for example to read your new emails when you asked for that. This is not end-to-end
        encryption: we hold what is needed to read it. When a task needs your computer (your files, the desktop, the
        bots’ browser, your own API key), it waits until you open oovi on your computer. Requests to theOovi made for
        these tasks are billed to your credits and handled as in section 2.
      </p>
      <p>
        <b>People at oovi don’t read your chats.</b> As a rule of the product, our admin console never shows the
        content of chats or sign-ins: only whether an account syncs, how many chats, how much space, when it last
        synced and its devices. There is no screen or tool for our team to read them. This is a rule we keep, not a
        technical impossibility, and we would only access them where the law requires it.
      </p>
      <p>
        <b>Turning it off and deleting.</b> Turn sync off in the App (Settings &gt; Sync) at any time. The App asks
        you first, then everything above is deleted from our server at once (your computer keeps its own copy). A chat
        you delete is removed from our server at once; a small marker without content (its id and the time) stays up
        to 30 days so your other devices remove it too. Deleting your oovi account deletes all of it.
      </p>

      <h2>4. What we collect for your account</h2>
      <p>When you create and use an oovi account, we store:</p>
      <ul>
        <li><b>Email address and name</b>: to identify your account and let you sign in.</li>
        <li><b>Password</b>: stored only as a secure hash; we can’t see your actual password.</li>
        <li><b>Profile photo</b> (optional): a small image you upload.</li>
        <li><b>Terms acceptance</b>: the date and version of the Terms and Privacy Policy you accepted.</li>
        <li>
          <b>Sign-in sessions</b>: session tokens, their expiry, and the IP address and device/browser information
          (user agent) of each session, to keep you signed in and protect your account.
        </li>
      </ul>
      <p>If you use theOovi or our pilot program, we also store:</p>
      <ul>
        <li>
          <b>Credits</b>: your balance, plan, daily usage and a history of credit changes (for example welcome credits,
          plan credits, and adjustments made by our team).
        </li>
        <li>
          <b>theOovi usage numbers</b>: per day, how many requests you made, tokens used, cost, credits used and
          errors. Never the content of your requests.
        </li>
        <li>
          <b>A network check for welcome credits</b>: a one-way, salted fingerprint of the network address you first
          used, so we can limit free welcome credits per network and stop mass sign-ups. We can’t turn it back into an
          IP address.
        </li>
        <li>
          <b>Pilot requests and feedback</b>: what you write in the pilot form (how you’ll use oovi, and optionally your
          organization, role and team size) and any feedback you send us, with the App version and operating system.
        </li>
      </ul>
      <p>If you buy a plan, we also store:</p>
      <ul>
        <li>
          <b>Billing records from Paddle</b>: your Paddle customer and subscription IDs, the email Paddle has for you,
          which plan you bought, its status and renewal date, and each payment’s amounts, currency, tax and refunds. We
          use them to give your plan’s credits, show your billing, and keep our accounts.
        </li>
      </ul>
      <p>
        Payments are handled by <b>Paddle</b> (Paddle.com), our reseller and Merchant of Record. You enter your card or
        other payment details in Paddle’s checkout, never on our servers: we never see or store your full card number.
        Paddle processes your payment and billing details under its own{" "}
        <a href="https://www.paddle.com/legal/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
      </p>
      <p>
        We do <b>not</b> store the content of your chats, prompts or files, unless you turn on cloud sync (section 3).
        Your setup and Telegram messages are kept only as described in section 2.
      </p>

      <h2>5. Crash reports and usage statistics</h2>
      <p>
        If the App runs into an error, it may send a crash report to help us fix bugs. A crash report contains the App
        version, your operating system, and technical error details (an error message, a stack trace and limited
        technical context). Crash reports are not meant to contain your chats or content, and we design them to avoid
        it. If you are signed in, a crash report may be linked to your account.
      </p>
      <p>
        With the same setting, the App may also send short notes about a problem with one of its own tools (for
        example, that a tool could not read a kind of page), with the name of the website concerned, and, when a bot
        could not complete a task, a one-line description of the kind of task in general words and what blocked it
        (for example, &ldquo;changing the desktop wallpaper; the screen could not be captured&rdquo;), never its
        details. Before a note is
        sent, the App removes email addresses, phone numbers and other numbers, file paths, quoted text and the rest
        of a page&rsquo;s address. You can turn crash reports and these notes off in the App&rsquo;s Settings.
      </p>
      <p>
        When you are signed in, the App also tells us its version and your operating system when it starts, and sends
        a daily summary of usage numbers (for example how many messages were sent, tool calls made and AI cost, plus
        how many bots, groups, connectors and skills you have set up). These are numbers only, never your chats,
        prompts, files or other content. Our website counts downloads by platform and country without storing IP
        addresses. We use this to understand how oovi is used and to improve it.
      </p>

      <h2>6. Website</h2>
      <p>
        Our website uses only the cookies needed to keep you signed in to your account. We don’t use advertising or
        cross-site tracking cookies. Our hosting provider may keep standard server logs (such as IP address and
        request details) for security and reliability.
      </p>

      <h2>7. How we use your data</h2>
      <ul>
        <li>to create and run your account and sign you in to the App and website;</li>
        <li>to keep the Service secure, prevent abuse and enforce our <Link href="/terms">Terms</Link>;</li>
        <li>to find and fix bugs using crash reports;</li>
        <li>to understand how oovi is used, using usage numbers and download counts;</li>
        <li>to run theOovi: check and charge credits, enforce daily limits, and prevent abuse;</li>
        <li>to review pilot requests and act on your feedback;</li>
        <li>to contact you about important changes to the Service, your account, or these policies;</li>
        <li>
          to tell you about oovi news (a new expert, a new feature) in the App and by email. We note whether you saw
          or closed a piece of news in the App, so it isn’t shown again. You can stop news emails at any time with the
          link at the bottom of each one or on your account page; emails about your account still come.
        </li>
      </ul>
      <p>
        We rely on the following legal bases where they apply: performing our contract with you (running your
        account), our legitimate interests (security and fixing bugs), and legal obligations. We do not sell your
        personal data and we don’t use it for advertising.
      </p>

      <h2>8. Who we share it with</h2>
      <p>
        We use a small number of service providers to run oovi, who process data on our behalf: our website and API
        hosting provider, our database provider, the cloud server provider that runs tasks while your computer is off
        (for people who turn on cloud sync), our reseller Paddle (for purchases, payments, tax and receipts) and, for theOovi requests only, our AI provider (Anthropic). They may store data in other countries; where required, we rely on
        appropriate safeguards for international transfers. We may also disclose data if required by law, or to
        protect the rights and safety of our users or others. If oovi is involved in a merger or acquisition, account
        data may be transferred as part of it, subject to this policy.
      </p>

      <h2>9. How long we keep it</h2>
      <ul>
        <li>Account data is kept while your account exists.</li>
        <li>Sign-in sessions expire after about 60 days of inactivity, or when you sign out.</li>
        <li>Crash reports are kept only as long as useful for fixing bugs, and no longer than 12 months.</li>
        <li>Credit records, theOovi usage numbers, pilot requests and feedback are kept while your account exists.</li>
        <li>Your setup copy is kept while your account exists. Telegram messages are kept until oovi collects them, 24 hours at most.</li>
        <li>
          Synced chats and connector sign-ins are kept while cloud sync is on; they are deleted at once when you turn
          it off or delete your account. A deleted chat leaves a marker without content for up to 30 days. Messages
          from your phone are deleted from our server within a day after they are handled.
        </li>
        <li>Billing and payment records are kept as long as tax and accounting laws require, even after you delete your account.</li>
      </ul>

      <h2>10. Deleting your account</h2>
      <p>
        You can delete your account at any time from your <Link href="/account">account page</Link>. This permanently
        deletes your account data (email, name, profile photo, terms acceptance, sessions), your credits and their
        history, theOovi usage numbers, pilot requests, feedback, crash reports, your setup copy, your cloud sync data (synced
        chats, connector sign-ins, messages from your phone and the list of your devices) and your Telegram relay data
        linked to your account. Backups, if any, are overwritten in the normal course. Deleting your account does not remove data
        stored in the App on your own computer; you can remove that by uninstalling the App and deleting its data
        folder.
      </p>

      <h2>11. Your rights</h2>
      <p>
        Depending on where you live, you may have the right to access, correct, delete or export your personal data,
        and to object to or restrict certain processing. You can update your name and photo and delete your account
        yourself. For anything else, email <Ph>{CONTACT_EMAIL}</Ph>. You also have the right to complain to your local
        data protection authority.
      </p>

      <h2>12. Security</h2>
      <p>
        We use reasonable measures to protect your data, including encrypted connections (HTTPS), hashed passwords and
        access controls. No system is perfectly secure, so please use a strong, unique password.
      </p>

      <h2>13. Children</h2>
      <p>
        oovi is only for people aged 18 or older, and we don’t knowingly collect data from anyone younger. If you
        believe someone under 18 has created an account, contact us and we’ll delete it.
      </p>

      <h2>14. Changes to this policy</h2>
      <p>
        We may update this policy. If changes are significant, we’ll let you know in the App or by email. The version
        and date at the top show the current version.
      </p>

      <h2>15. Contact</h2>
      <p>
        Questions or requests about privacy? Email <Ph>{CONTACT_EMAIL}</Ph>.
      </p>
    </LegalPage>
  );
}
