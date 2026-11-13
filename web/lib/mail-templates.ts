// oovi's emails: one warm, simple layout for every message. Built with tables and inline
// styles so it looks the same in Gmail, Outlook and Apple Mail, with a plain-text twin.
import { siteUrl } from "./site";
import { COMPANY_NAME, CONTACT_EMAIL } from "./legal";
import type { Mail } from "./mail";

const C = {
  page: "#f4f1ea",
  card: "#ffffff",
  border: "#e9e4d8",
  ink: "#171717",
  text: "#3d3c38",
  muted: "#8a887f",
  soft: "#faf8f3",
  accent: "#6f8cf0",
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const firstName = (name: string) => esc((name || "").trim().split(/\s+/)[0] || "there");

type Block = { kind: "p"; text: string } | { kind: "list"; items: string[] } | { kind: "facts"; rows: [string, string][] };

type Layout = {
  preheader: string;
  title: string;
  hello: string;
  blocks: Block[];
  button?: { label: string; url: string };
  note?: string;
};

function htmlBlock(b: Block): string {
  if (b.kind === "p") return `<p style="margin:0 0 16px;font:400 15px/1.65 ${FONT};color:${C.text};">${b.text}</p>`;
  if (b.kind === "list")
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">${b.items
      .map(
        (i) =>
          `<tr><td style="vertical-align:top;padding:2px 10px 6px 0;font:700 15px/1.6 ${FONT};color:${C.accent};">•</td><td style="padding:2px 0 6px;font:400 15px/1.6 ${FONT};color:${C.text};">${i}</td></tr>`,
      )
      .join("")}</table>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;background:${C.soft};border:1px solid ${C.border};border-radius:14px;">${b.rows
    .map(
      ([k, v], i) =>
        `<tr><td style="padding:12px 16px;${i ? `border-top:1px solid ${C.border};` : ""}font:400 14px/1.4 ${FONT};color:${C.muted};">${k}</td><td align="right" style="padding:12px 16px;${i ? `border-top:1px solid ${C.border};` : ""}font:700 14px/1.4 ${FONT};color:${C.ink};">${v}</td></tr>`,
    )
    .join("")}</table>`;
}

const strip = (s: string) =>
  s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function textBlock(b: Block): string {
  if (b.kind === "p") return strip(b.text);
  if (b.kind === "list") return b.items.map((i) => `- ${strip(i)}`).join("\n");
  return b.rows.map(([k, v]) => `${strip(k)}: ${strip(v)}`).join("\n");
}

function render(l: Layout, to: string, subject: string): Mail {
  const base = siteUrl();
  const button = l.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 22px;"><tr><td style="border-radius:999px;background:${C.ink};">
         <a href="${esc(l.button.url)}" style="display:inline-block;padding:14px 26px;font:700 15px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:999px;">${esc(l.button.label)}&nbsp;&nbsp;&rarr;</a>
       </td></tr></table>
       <p style="margin:0 0 6px;font:400 12px/1.6 ${FONT};color:${C.muted};">Button not working? Copy this link into your browser:</p>
       <p style="margin:0 0 18px;font:400 12px/1.6 ${FONT};word-break:break-all;"><a href="${esc(l.button.url)}" style="color:${C.accent};text-decoration:underline;">${esc(l.button.url)}</a></p>`
    : "";
  const note = l.note
    ? `<p style="margin:6px 0 0;padding-top:16px;border-top:1px solid ${C.border};font:400 13px/1.6 ${FONT};color:${C.muted};">${l.note}</p>`
    : "";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(l.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
      <tr><td style="padding:0 6px 18px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle;padding-right:10px;"><img src="${base}/mark.png" width="38" height="38" alt="" style="display:block;border:0;"></td>
          <td style="vertical-align:middle;font:800 24px/1 ${FONT};letter-spacing:-0.5px;color:${C.ink};">oovi</td>
        </tr></table>
      </td></tr>
      <tr><td style="background:${C.card};border:1px solid ${C.border};border-radius:22px;padding:34px 32px 28px;">
        <h1 style="margin:0 0 18px;font:800 26px/1.2 ${FONT};letter-spacing:-0.5px;color:${C.ink};">${esc(l.title)}</h1>
        <p style="margin:0 0 16px;font:400 15px/1.65 ${FONT};color:${C.text};">${l.hello}</p>
        ${l.blocks.map(htmlBlock).join("\n        ")}
        ${button}
        ${note}
      </td></tr>
      <tr><td align="center" style="padding:24px 12px 8px;font:400 12px/1.7 ${FONT};color:${C.muted};">
        <b style="color:${C.text};">oovi</b> &middot; your team of AI bots &middot; made by ${esc(COMPANY_NAME)}<br>
        Questions? Write to <a href="mailto:${esc(CONTACT_EMAIL)}" style="color:${C.muted};">${esc(CONTACT_EMAIL)}</a><br>
        <a href="${base}" style="color:${C.muted};">Website</a> &nbsp;&middot;&nbsp; <a href="${base}/privacy" style="color:${C.muted};">Privacy</a> &nbsp;&middot;&nbsp; <a href="${base}/terms" style="color:${C.muted};">Terms</a>
      </td></tr>
      <tr><td align="center" style="padding:4px 12px 0;font:400 11px/1.6 ${FONT};color:#a9a79f;">You&rsquo;re receiving this email because of your oovi account (${esc(to)}).</td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
  const text = [
    "oovi",
    "",
    l.title,
    "",
    strip(l.hello),
    "",
    ...l.blocks.flatMap((b) => [textBlock(b), ""]),
    ...(l.button ? [`${l.button.label}: ${l.button.url}`, ""] : []),
    ...(l.note ? [strip(l.note), ""] : []),
    "--",
    `oovi - made by ${COMPANY_NAME} - ${CONTACT_EMAIL}`,
    `${base} | ${base}/privacy | ${base}/terms`,
  ].join("\n");
  return { to, subject, html, text };
}

// ---------- the messages ----------

/** code: the 6-digit code typed in oovi's sign-up form (null when it couldn't be made: the link still works). */
export function verifyEmail(to: string, name: string, url: string, code: string | null = null): Mail {
  return render(
    {
      preheader: code ? `Your oovi code: ${code}` : "One click to confirm your email and start with theOovi.",
      title: "Confirm your email",
      hello: `Hi ${firstName(name)},`,
      blocks: [
        ...(code
          ? [
              { kind: "p" as const, text: "Welcome to oovi! Type this code in oovi to confirm your email and open your account:" },
              { kind: "p" as const, text: `<span style="font-size:32px;font-weight:700;letter-spacing:8px;font-family:monospace">${code}</span>` },
              { kind: "p" as const, text: "Or confirm with the button below." },
            ]
          : [
              {
                kind: "p" as const,
                text: "Welcome to oovi! Please confirm this is your email address. It keeps your account safe and unlocks your free credits for <b>theOovi</b>, the AI model included with your account.",
              },
            ]),
      ],
      button: { label: "Confirm my email", url },
      note: `${code ? "The code works for 1 hour, the button for 24 hours." : "This link works for 24 hours."} If you didn&rsquo;t create an oovi account, you can ignore this email.`,
    },
    to,
    code ? `${code} is your oovi code` : "Confirm your email for oovi",
  );
}

/** A code on its own (sent only through the email-OTP plugin's own endpoint). */
export function verifyCode(to: string, code: string): Mail {
  return render(
    {
      preheader: `Your oovi code: ${code}`,
      title: "Your oovi code",
      hello: "Hi,",
      blocks: [
        { kind: "p", text: "Type this code in oovi to confirm your email:" },
        { kind: "p", text: `<span style="font-size:32px;font-weight:700;letter-spacing:8px;font-family:monospace">${code}</span>` },
      ],
      note: "The code works for 1 hour. If you didn&rsquo;t ask for it, you can ignore this email.",
    },
    to,
    `${code} is your oovi code`,
  );
}

export function resetPassword(to: string, name: string, url: string): Mail {
  return render(
    {
      preheader: "Choose a new password for your oovi account.",
      title: "Reset your password",
      hello: `Hi ${firstName(name)},`,
      blocks: [{ kind: "p", text: "Someone (hopefully you) asked to reset the password for your oovi account. Choose a new one with the button below." }],
      button: { label: "Choose a new password", url },
      note: "This link works for 1 hour and only once. If you didn&rsquo;t ask for this, ignore this email: your password stays the same.",
    },
    to,
    "Reset your oovi password",
  );
}

export function passwordChanged(to: string, name: string): Mail {
  return render(
    {
      preheader: "Your oovi password was just changed.",
      title: "Your password was changed",
      hello: `Hi ${firstName(name)},`,
      blocks: [
        { kind: "p", text: "The password for your oovi account was just changed, and you were signed out on your other devices." },
        {
          kind: "p",
          text: `If this wasn&rsquo;t you, reset your password right away and write to us at <a href="mailto:${esc(CONTACT_EMAIL)}" style="color:${C.accent};">${esc(CONTACT_EMAIL)}</a>.`,
        },
      ],
      button: { label: "Reset my password", url: `${siteUrl()}/forgot-password` },
    },
    to,
    "Your oovi password was changed",
  );
}

export function pilotApproved(to: string, name: string, credits: number, days: number, dailyLimit: number): Mail {
  const n = (v: number) => new Intl.NumberFormat("en-US").format(v);
  return render(
    {
      preheader: `${n(credits)} credits are now in your oovi account.`,
      title: "You’re in the oovi pilot",
      hello: `Hi ${firstName(name)},`,
      blocks: [
        { kind: "p", text: "Great news: your pilot request was approved. Your credits are ready to use in the oovi app right now." },
        {
          kind: "facts",
          rows: [
            ["Credits added", n(credits)],
            ["Pilot plan", `${n(days)} days`],
            ["Daily safety limit", `${n(dailyLimit)} credits`],
          ],
        },
        {
          kind: "p",
          text: "As a pilot member, your feedback shapes oovi. When something doesn&rsquo;t work or you have an idea, tell us with <b>Send feedback</b> in the app, or on the website.",
        },
      ],
      button: { label: "Send feedback", url: `${siteUrl()}/feedback` },
      note: "Thank you for helping us build oovi.",
    },
    to,
    "You’re in the oovi pilot: your credits are ready",
  );
}

export function testEmail(to: string): Mail {
  return render(
    {
      preheader: "Your oovi email settings work.",
      title: "Email is working",
      hello: "Hi,",
      blocks: [
        {
          kind: "p",
          text: "This is a test from the oovi admin console. If you&rsquo;re reading it, your mail server settings are correct and oovi can send these emails:",
        },
        { kind: "list", items: ["Confirm your email", "Reset your password", "Your password was changed", "You&rsquo;re in the oovi pilot"] },
      ],
      button: { label: "Open the console", url: `${siteUrl()}/admin/email` },
    },
    to,
    "oovi test email",
  );
}

/** Example versions of every message, for the console's previews. */
export function previews(to: string): Record<string, Mail> {
  const base = siteUrl();
  return {
    verify: verifyEmail(to, "Sara Benali", `${base}/api/auth/verify-email?token=example`),
    reset: resetPassword(to, "Sara Benali", `${base}/reset-password?token=example`),
    changed: passwordChanged(to, "Sara Benali"),
    pilot: pilotApproved(to, "Sara Benali", 10_000, 60, 5_000),
    test: testEmail(to),
  };
}
