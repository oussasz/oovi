import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/admin";
import { smtpStatus } from "@/lib/mail";
import { previews } from "@/lib/mail-templates";
import { ActionForm } from "@/components/admin/ActionForm";
import { PageHead, Section } from "@/components/admin/ui";
import { fmtDateTime } from "@/components/admin/format";
import { removeEmailPassword, saveEmailSettings, sendTestEmail } from "./actions";
import { EmailPreviews, type PreviewItem } from "./EmailPreviews";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Email" };

function Field({ id, label, help, children }: { id: string; label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {help && (
        <span className="adm-help" id={`${id}-help`}>
          {help}
        </span>
      )}
    </div>
  );
}

const LABELS: Record<string, string> = {
  verify: "Confirm your email",
  reset: "Reset your password",
  changed: "Password changed",
  pilot: "Pilot approved",
  invite: "Pilot invitation (personal)",
  test: "Test",
};

export default async function AdminEmail() {
  const admin = await requireAdmin();
  const { cfg, hasPassword, ready, updatedAt } = await smtpStatus();
  const missing = [!cfg.host && "server", !cfg.user && "username", !hasPassword && "password", !cfg.fromEmail && "sender email"].filter(
    Boolean,
  ) as string[];
  const all = previews(admin.email);
  const items: PreviewItem[] = Object.keys(all).map((key) => ({ key, label: LABELS[key] ?? key, subject: all[key]!.subject }));

  return (
    <>
      <PageHead
        title="Email"
        sub="oovi sends its emails (confirm your email, password reset, pilot approval) through your own mail server. The password is stored encrypted and never shown again."
      />

      <div className="adm-kpis mail-status">
        <div className="adm-kpi">
          <span className="adm-kpi-label">Status</span>
          <span className="adm-kpi-value">
            <span className={`adm-badge ${ready ? "on" : "warn"}`}>{ready ? "Ready" : "Not set up"}</span>
          </span>
          <span className="adm-kpi-hint">{ready ? `Sending as ${cfg.fromEmail}` : `Missing: ${missing.join(", ")}`}</span>
        </div>
        <div className="adm-kpi">
          <span className="adm-kpi-label">Last saved</span>
          <span className="adm-kpi-value mail-status-text">{updatedAt ? fmtDateTime(updatedAt) : "Never"}</span>
        </div>
        <div className="adm-kpi">
          <span className="adm-kpi-label">Email confirmation</span>
          <span className="adm-kpi-value mail-status-text">{cfg.requireVerified && ready ? "Required" : "Not required"}</span>
          <span className="adm-kpi-hint">
            {cfg.requireVerified
              ? ready
                ? "Free credits work once people confirm their email."
                : "Switched on, but waits until email is set up."
              : "Free credits work without a confirmed email."}
          </span>
        </div>
      </div>

      <div className="adm-grid-2">
        <Section title="Mail server (SMTP)" sub="Use the details from your email provider. Saved changes apply within about 15 seconds.">
          <ActionForm action={saveEmailSettings} submitLabel="Save settings">
            <div className="adm-fields adm-fields-wide">
              <Field id="host" label="Server" help="For example smtp.gmail.com">
                <input id="host" name="host" className="input adm-mono" maxLength={253} defaultValue={cfg.host} placeholder="smtp.example.com" spellCheck={false} autoComplete="off" />
              </Field>
              <Field id="port" label="Port" help="465 for SSL, 587 for STARTTLS.">
                <input id="port" name="port" className="input" type="number" min={1} max={65535} step={1} defaultValue={cfg.port} required />
              </Field>
              <Field id="security" label="Security">
                <select id="security" name="security" className="input" defaultValue={cfg.security}>
                  <option value="ssl">SSL (port 465)</option>
                  <option value="starttls">STARTTLS (port 587)</option>
                </select>
              </Field>
              <Field id="user" label="Username" help="Usually the full email address of the mailbox.">
                <input id="user" name="user" className="input" maxLength={254} defaultValue={cfg.user} spellCheck={false} autoComplete="off" />
              </Field>
              <Field
                id="password"
                label="Password"
                help={hasPassword ? "A password is saved. Leave this empty to keep it." : "Not set yet. For Gmail, use an app password."}
              >
                <input
                  id="password"
                  name="password"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  maxLength={300}
                  placeholder={hasPassword ? "••••••••  (saved)" : ""}
                  aria-describedby="password-help"
                />
              </Field>
            </div>
            <div className="adm-fields adm-fields-wide">
              <Field id="fromName" label="Sender name" help="What people see as the sender.">
                <input id="fromName" name="fromName" className="input" maxLength={60} defaultValue={cfg.fromName} />
              </Field>
              <Field id="fromEmail" label="Sender email" help="Must be an address your server may send from.">
                <input id="fromEmail" name="fromEmail" className="input" type="email" maxLength={254} defaultValue={cfg.fromEmail} placeholder="hello@example.com" />
              </Field>
              <Field id="replyTo" label="Reply-to email" help="Where replies go. Empty = the sender email.">
                <input id="replyTo" name="replyTo" className="input" type="email" maxLength={254} defaultValue={cfg.replyTo} />
              </Field>
            </div>
            <label className="check">
              <input type="checkbox" name="requireVerified" defaultChecked={cfg.requireVerified} />
              <span>
                <b>Require a confirmed email before free credits work.</b> Only applies once email is set up and ready, so nobody gets stuck
                waiting for an email that can’t be sent.
              </span>
            </label>
          </ActionForm>
          {hasPassword && (
            <div style={{ marginTop: 14 }}>
              <ActionForm
                action={removeEmailPassword}
                submitLabel="Remove password"
                pendingLabel="Removing…"
                submitClassName="btn btn-ghost btn-sm"
                confirm={"Remove the saved mail server password?\n\noovi stops sending emails (confirmation, password reset, pilot) until you add it again."}
              />
            </div>
          )}
        </Section>

        <div className="mail-side">
          <Section title="Send a test email" sub="Checks the saved settings by sending a real email.">
            <ActionForm action={sendTestEmail} submitLabel="Send test email" pendingLabel="Sending…">
              <Field id="test-to" label="Send to">
                <input id="test-to" name="to" className="input" type="email" maxLength={254} defaultValue={admin.email} required />
              </Field>
            </ActionForm>
          </Section>

          <Section title="Common settings">
            <dl className="adm-dl mail-help">
              <dt>Gmail / Google Workspace</dt>
              <dd>
                <span className="adm-mono">smtp.gmail.com</span>, 465, SSL. Needs an <b>app password</b> (Google account › Security › 2-Step
                Verification › App passwords), not your normal password.
              </dd>
              <dt>Zoho Mail</dt>
              <dd>
                <span className="adm-mono">smtp.zoho.com</span>, 465, SSL (<span className="adm-mono">smtp.zoho.eu</span> for EU accounts).
              </dd>
              <dt>Hostinger</dt>
              <dd>
                <span className="adm-mono">smtp.hostinger.com</span>, 465, SSL.
              </dd>
              <dt>Outlook / Microsoft 365</dt>
              <dd>
                <span className="adm-mono">smtp.office365.com</span>, 587, STARTTLS.
              </dd>
            </dl>
            <p className="adm-help" style={{ marginTop: 12 }}>
              Username is usually the full mailbox address, and the sender email should be that same address (or an alias it may use).
            </p>
          </Section>
        </div>
      </div>

      <Section title="Previews" sub={`What people receive. These examples are filled in with sample details and your address (${admin.email}).`}>
        <EmailPreviews items={items} />
      </Section>
    </>
  );
}
