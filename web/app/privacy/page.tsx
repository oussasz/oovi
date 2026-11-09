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
          <b>The short version:</b> your bots, chats, memories, skills and API keys stay on your computer. We never
          receive your conversations. Your oovi account only stores what we need to sign you in (email, name, optional
          profile photo, and when you accepted our terms), plus crash reports and simple usage numbers (never your content)
          that help us fix bugs and improve oovi. You can
          delete your account at any time.
        </p>
      }
    >
      <h2>1. Who is responsible</h2>
      <p>
        <Ph>{COMPANY_NAME}</Ph> (“oovi”, “we”, “us”) is responsible for the personal data described in this policy.
        You can reach us at <Ph>{CONTACT_EMAIL}</Ph>.
      </p>

      <h2>2. What stays on your device</h2>
      <p>The oovi App is designed to keep your work local. The following is stored only on your own computer:</p>
      <ul>
        <li>your bots and their settings, chats, prompts, files, memories and skills;</li>
        <li>your AI provider API keys, which are stored encrypted;</li>
        <li>results and content your bots produce.</li>
      </ul>
      <p>
        We do not receive, store or read this data. When your bots use an AI model, your requests go directly from your
        device to the AI provider you chose, using your own key. That provider processes your data under its own
        privacy policy and terms, so please review them. Likewise, websites your bots visit receive data under their
        own policies.
      </p>

      <h2>3. What we collect for your account</h2>
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
      <p>We do <b>not</b> collect anything from your chats, prompts, memories, skills or files.</p>

      <h2>4. Crash reports and usage statistics</h2>
      <p>
        If the App runs into an error, it may send a crash report to help us fix bugs. A crash report contains the App
        version, your operating system, and technical error details (an error message, a stack trace and limited
        technical context). Crash reports are not meant to contain your chats or content, and we design them to avoid
        it. If you are signed in, a crash report may be linked to your account.
      </p>
      <p>
        When you are signed in, the App also tells us its version and your operating system when it starts, and sends
        a daily summary of usage numbers (for example how many messages were sent, tool calls made and AI cost, plus
        how many bots, groups, connectors and skills you have set up). These are numbers only, never your chats,
        prompts, files or other content. Our website counts downloads by platform and country without storing IP
        addresses. We use this to understand how oovi is used and to improve it.
      </p>

      <h2>5. Website</h2>
      <p>
        Our website uses only the cookies needed to keep you signed in to your account. We don’t use advertising or
        cross-site tracking cookies. Our hosting provider may keep standard server logs (such as IP address and
        request details) for security and reliability.
      </p>

      <h2>6. How we use your data</h2>
      <ul>
        <li>to create and run your account and sign you in to the App and website;</li>
        <li>to keep the Service secure, prevent abuse and enforce our <Link href="/terms">Terms</Link>;</li>
        <li>to find and fix bugs using crash reports;</li>
        <li>to understand how oovi is used, using usage numbers and download counts;</li>
        <li>to contact you about important changes to the Service, your account, or these policies.</li>
      </ul>
      <p>
        We rely on the following legal bases where they apply: performing our contract with you (running your
        account), our legitimate interests (security and fixing bugs), and legal obligations. We do not sell your
        personal data and we don’t use it for advertising.
      </p>

      <h2>7. Who we share it with</h2>
      <p>
        We use a small number of service providers to run oovi, who process data on our behalf: our website and API
        hosting provider and our database provider. They may store data in other countries; where required, we rely on
        appropriate safeguards for international transfers. We may also disclose data if required by law, or to
        protect the rights and safety of our users or others. If oovi is involved in a merger or acquisition, account
        data may be transferred as part of it, subject to this policy.
      </p>

      <h2>8. How long we keep it</h2>
      <ul>
        <li>Account data is kept while your account exists.</li>
        <li>Sign-in sessions expire after about 60 days of inactivity, or when you sign out.</li>
        <li>Crash reports are kept only as long as useful for fixing bugs, and no longer than 12 months.</li>
      </ul>

      <h2>9. Deleting your account</h2>
      <p>
        You can delete your account at any time from your <Link href="/account">account page</Link>. This permanently
        deletes your account data (email, name, profile photo, terms acceptance, sessions) and crash reports linked to
        your account. Backups, if any, are overwritten in the normal course. Deleting your account does not remove data
        stored in the App on your own computer; you can remove that by uninstalling the App and deleting its data
        folder.
      </p>

      <h2>10. Your rights</h2>
      <p>
        Depending on where you live, you may have the right to access, correct, delete or export your personal data,
        and to object to or restrict certain processing. You can update your name and photo and delete your account
        yourself. For anything else, email <Ph>{CONTACT_EMAIL}</Ph>. You also have the right to complain to your local
        data protection authority.
      </p>

      <h2>11. Security</h2>
      <p>
        We use reasonable measures to protect your data, including encrypted connections (HTTPS), hashed passwords and
        access controls. No system is perfectly secure, so please use a strong, unique password.
      </p>

      <h2>12. Children</h2>
      <p>
        oovi is not intended for children under 16, and we don’t knowingly collect their data. If you believe a child
        has created an account, contact us and we’ll delete it.
      </p>

      <h2>13. Changes to this policy</h2>
      <p>
        We may update this policy. If changes are significant, we’ll let you know in the App or by email. The version
        and date at the top show the current version.
      </p>

      <h2>14. Contact</h2>
      <p>
        Questions or requests about privacy? Email <Ph>{CONTACT_EMAIL}</Ph>.
      </p>
    </LegalPage>
  );
}
