import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, Ph } from "@/components/LegalPage";
import { CONTACT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Refund Policy",
  description: "How refunds and cancellations work for oovi’s paid plans: a full refund within 14 days of any payment.",
};

export default function RefundPage() {
  return (
    <LegalPage
      title="Refund Policy"
      summary={
        <p>
          <b>The short version:</b> if a paid plan isn’t right for you, ask within 14 days of a payment and you get that
          payment back in full. You can cancel at any time from your account page, and you keep your plan until the end of
          the period you paid for.
        </p>
      }
    >
      <h2>1. Who handles your payment</h2>
      <p>
        Our paid plans are sold through Paddle (Paddle.com), our reseller and Merchant of Record. Paddle takes the payment,
        handles sales tax and VAT, and sends your receipts. Refunds are paid back by Paddle to the payment method you used.
      </p>

      <h2>2. 14-day refunds</h2>
      <p>
        You can ask for a full refund within 14 days of any payment for an oovi plan: your first payment, and every
        monthly or yearly renewal. You don’t need to give a reason.
      </p>
      <ul>
        <li>
          Write to <Ph>{CONTACT_EMAIL}</Ph> from the email address on your oovi account, or reply to your Paddle receipt.
        </li>
        <li>Tell us which payment you want refunded (the date or the receipt is enough).</li>
        <li>
          We approve it within 2 business days. The money usually shows in your account within 5 to 10 business days,
          depending on your bank or card.
        </li>
      </ul>
      <p>
        When a payment is refunded, the plan it paid for ends, and the credits that came with it are removed from your
        balance. Credits you received for free (welcome or pilot credits) and anything you set up in oovi stay yours.
      </p>

      <h2>3. Cancelling</h2>
      <p>
        You can cancel at any time on your <Link href="/account">account page</Link> (“Manage billing”). Your plan stays
        active until the end of the month or year you already paid for, then it isn’t renewed and you aren’t charged
        again. Cancelling on its own doesn’t refund the current period; ask for a refund as described above if you’re
        within 14 days of the payment.
      </p>

      <h2>4. After 14 days</h2>
      <p>
        Payments older than 14 days aren’t normally refunded. If something went wrong (for example, you were charged twice
        or the service didn’t work for you), write to us anyway and we’ll look at it fairly. This policy doesn’t limit any
        rights you have under the consumer law of your country.
      </p>

      <h2>5. Contact</h2>
      <p>
        Questions about a payment or a refund: <Ph>{CONTACT_EMAIL}</Ph>. You can also contact Paddle about any order at{" "}
        <a href="https://paddle.net" target="_blank" rel="noopener noreferrer">
          paddle.net
        </a>
        .
      </p>
    </LegalPage>
  );
}
