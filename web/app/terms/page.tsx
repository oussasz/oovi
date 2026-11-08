import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, Ph } from "@/components/LegalPage";
import { COMPANY_NAME, CONTACT_EMAIL, JURISDICTION } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      summary={
        <p>
          <b>The short version:</b> oovi is a desktop app that lets you run a team of AI agents with your own AI
          provider keys. It’s free during the pilot. You’re responsible for what you ask your bots to do. AI can make
          mistakes, so check important results. The software is provided as is. The rest of this page explains the
          details.
        </p>
      }
    >
      <h2>1. Who we are and what these terms cover</h2>
      <p>
        These Terms of Service (“Terms”) are an agreement between you and <Ph>{COMPANY_NAME}</Ph> (“oovi”, “we”,
        “us”). They cover your use of the oovi desktop application (the “App”), the oovi website, and your oovi
        account (together, the “Service”). By creating an account, downloading or using the Service, you agree to
        these Terms and to our <Link href="/privacy">Privacy Policy</Link>. If you don’t agree, please don’t use the
        Service.
      </p>
      <p>
        You must be at least 16 years old (or the age of digital consent where you live, if higher) to use the
        Service. If you use oovi on behalf of an organization, you confirm you’re allowed to accept these Terms for
        it.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>You need an oovi account to sign in to the App. Give us accurate information and keep it up to date.</li>
        <li>Keep your password safe. You’re responsible for activity that happens under your account.</li>
        <li>Tell us right away at <Ph>{CONTACT_EMAIL}</Ph> if you think someone else is using your account.</li>
        <li>You can delete your account at any time from your account page.</li>
      </ul>

      <h2>3. Pilot, pricing and changes</h2>
      <p>
        oovi is currently in a pilot phase and is free to use. We may introduce paid plans or paid features in the
        future (for example, backup and sync across devices). We’ll tell you before any paid plan applies to you, and
        we will never charge you without your clear agreement.
      </p>
      <p>
        Because oovi is in a pilot, features may change, be limited, or be removed, and the Service may sometimes be
        unavailable. We may update the App from time to time.
      </p>

      <h2>4. Your AI provider keys and costs</h2>
      <p>
        oovi works with AI models from third-party providers using API keys that <b>you</b> supply (“bring your own
        key”). You are responsible for having a valid account with those providers, for following their terms and
        usage policies, and for all fees they charge. You pay providers directly; we don’t resell or mark up AI usage
        and we aren’t responsible for provider charges, outages, rate limits or changes to their models.
      </p>
      <p>
        Your API keys are stored on your own device, encrypted. Keep them secret, and revoke them with your provider
        if you think they have been exposed.
      </p>

      <h2>5. Acceptable use and your responsibility</h2>
      <p>
        oovi lets AI agents take actions for you, which can include browsing websites, filling in forms, running
        automations and creating content. <b>You are responsible for how you use your bots and for everything they do
        on your instructions.</b> In particular, you agree that you will:
      </p>
      <ul>
        <li>
          comply with all laws that apply to you, and with the terms of service and rules of any third-party website,
          app or service your bots access or automate (some sites prohibit automated access or scraping);
        </li>
        <li>not use the Service to break the law, infringe anyone’s rights, or harm, harass, deceive or spam others;</li>
        <li>not use the Service to gain unauthorized access to systems, accounts or data, or to bypass security measures;</li>
        <li>not create or distribute malware, or generate content that is illegal or sexually exploits minors;</li>
        <li>review actions before approving them, especially anything involving money, messages to other people, or deleting data.</li>
      </ul>
      <p>We may suspend or close accounts that break these rules or put others at risk.</p>

      <h2>6. AI output can be wrong</h2>
      <p>
        AI models can produce information that is inaccurate, incomplete, outdated, biased or offensive, and agents
        can make mistakes when taking actions. Output is not professional (legal, medical, financial or other) advice.
        Check important results yourself before relying on them. You are responsible for how you use the output.
      </p>

      <h2>7. Your content</h2>
      <p>
        Your prompts, files, chats, memories, skills and the results your bots produce (“Your Content”) belong to you,
        to the extent the law and your AI provider’s terms allow. Your Content is stored locally on your device; we
        don’t receive it and don’t claim any rights to it. You are responsible for having the rights to anything you
        give your bots.
      </p>

      <h2>8. Our software and license</h2>
      <p>
        oovi is proprietary, closed-source software. All rights, title and interest in the Service, including the App,
        its code, design, characters, logos and the “oovi” name, belong to <Ph>{COMPANY_NAME}</Ph> and its licensors.
        All rights reserved.
      </p>
      <p>
        Subject to these Terms, we grant you a personal, limited, non-exclusive, non-transferable, revocable license to
        install and use the App on computers you own or control, for your personal or internal business use. You may
        not: copy, modify or distribute the App; sell, rent or sublicense it; reverse engineer, decompile or
        disassemble it (except where the law expressly allows this despite this restriction); remove proprietary
        notices; or use the Service to build a competing product.
      </p>
      <p>
        The App may include open-source components that are licensed under their own terms, which apply to those
        components.
      </p>

      <h2>9. Unsigned builds during the pilot</h2>
      <p>
        During the pilot, the App may not be code-signed, so your operating system may show a warning when you first
        open it. Only download oovi from this website.
      </p>

      <h2>10. Feedback</h2>
      <p>
        If you send us ideas or feedback, we may use them to improve oovi without any obligation to you.
      </p>

      <h2>11. No warranty</h2>
      <p>
        To the fullest extent permitted by law, the Service is provided <b>“as is” and “as available”</b>, without
        warranties of any kind, whether express or implied, including warranties of merchantability, fitness for a
        particular purpose, non-infringement, and that the Service will be uninterrupted, secure or error-free. We
        don’t guarantee any particular result from using AI agents. Some jurisdictions don’t allow certain warranty
        exclusions, so some of the above may not apply to you.
      </p>

      <h2>12. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, <Ph>{COMPANY_NAME}</Ph> and its team will not be liable for any
        indirect, incidental, special, consequential or punitive damages, or for any loss of profits, revenue, data,
        goodwill, or for charges from AI providers or third parties, arising from or related to your use of the
        Service or anything your bots do, even if we were told such damages were possible.
      </p>
      <p>
        Our total liability for any claim relating to the Service is limited to the greater of (a) the amount you
        paid us for the Service in the 12 months before the claim, or (b) 50 US dollars. Nothing in these Terms
        limits liability that cannot be limited by law, such as liability for fraud or for death or personal injury
        caused by negligence.
      </p>

      <h2>13. Indemnity</h2>
      <p>
        To the extent permitted by law, you agree to defend and indemnify <Ph>{COMPANY_NAME}</Ph> against claims,
        losses and costs (including reasonable legal fees) arising from your use of the Service, Your Content, your
        bots’ actions on your instructions, or your breach of these Terms or of any law or third-party terms.
      </p>

      <h2>14. Ending these Terms</h2>
      <p>
        You can stop using oovi and delete your account at any time. We may suspend or end your access if you break
        these Terms, if required by law, or if we discontinue the Service (we’ll try to give reasonable notice). When
        your account is deleted, your account data is deleted as described in our Privacy Policy. Sections that by
        their nature should continue (such as 8, 11, 12, 13 and 16) survive.
      </p>

      <h2>15. Changes to these Terms</h2>
      <p>
        We may update these Terms. If a change is significant, we’ll let you know (for example, in the App or by
        email) and may ask you to accept the new version. The version and date at the top of this page show which
        Terms apply. Continuing to use the Service after changes take effect means you accept them.
      </p>

      <h2>16. Governing law</h2>
      <p>
        These Terms are governed by the laws of <Ph>{JURISDICTION}</Ph>, without regard to conflict-of-law rules. Any
        dispute will be handled by the competent courts of <Ph>{JURISDICTION}</Ph>, unless the law where you live
        gives you the right to bring a claim in your local courts. If any part of these Terms is found unenforceable,
        the rest stays in effect.
      </p>

      <h2>17. Contact</h2>
      <p>
        Questions about these Terms? Email us at <Ph>{CONTACT_EMAIL}</Ph>.
      </p>
    </LegalPage>
  );
}
