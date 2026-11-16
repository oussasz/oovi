"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { framedHtml, FRAME_SANDBOX } from "@/lib/announcement-frame";
import type { Announcement } from "@/lib/announcements";
import { changeStatus, removeAnn, saveAnn, sendAnnEmails, sendAnnTest, type AnnState } from "../actions";

/** A starting point that looks right in the app's window and in mail apps (tables and inline styles). */
const STARTER = `<!doctype html>
<html>
<body style="margin:0;background:#f7f5ef;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1d1d1b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5ef;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:22px;overflow:hidden">
        <tr><td style="background:#fdda80;padding:34px 32px 26px;text-align:center">
          <div style="font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#7a5a00">New on oovi</div>
          <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2">Meet our new expert</h1>
        </td></tr>
        <tr><td style="padding:28px 32px 8px;font-size:16px;line-height:1.6">
          <p style="margin:0 0 14px">[Name] joins oovi as an expert in [field]. Add their assistant to your team from the Marketplace, in one click.</p>
          <p style="margin:0 0 14px">What it can do for you:</p>
          <ul style="margin:0 0 18px;padding-left:20px">
            <li>[First thing]</li>
            <li>[Second thing]</li>
            <li>[Third thing]</li>
          </ul>
        </td></tr>
        <tr><td align="center" style="padding:6px 32px 34px">
          <a href="https://oovi.conuron.com" style="display:inline-block;background:#1d1d1b;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:999px">Open oovi</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

type View = "window" | "bar" | "email";

export function AnnEditor({ a, adminEmail, counts }: { a: (Announcement & { stats: Record<string, number> }) | null; adminEmail: string; counts: { sent: number; left: number } | null }) {
  const router = useRouter();
  const [state, save, saving] = useActionState<AnnState, FormData>(saveAnn, null);
  const [title, setTitle] = useState(a?.title ?? "");
  const [barText, setBarText] = useState(a?.barText ?? "");
  const [html, setHtml] = useState(a?.html ?? STARTER);
  const [ch, setCh] = useState({ email: a?.email ?? false, window: a?.window ?? true, bar: a?.bar ?? true });
  const [audience, setAudience] = useState<"all" | "test">(a?.testEmail ? "test" : a ? "all" : "test");
  const [testEmail, setTestEmail] = useState(a?.testEmail || adminEmail);
  const [testTo, setTestTo] = useState(adminEmail);
  const [view, setView] = useState<View>("window");
  const [msg, setMsg] = useState<AnnState>(null);
  const [busy, start] = useTransition();
  const [dirty, setDirty] = useState(false);

  // A new announcement gets its own address once saved.
  useEffect(() => {
    if (state?.id && !a) router.replace(`/admin/announcements/edit?id=${state.id}`);
    if (state?.ok) setDirty(false);
  }, [state, a, router]);

  const act = (fn: () => Promise<AnnState>) =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      setMsg(r);
      router.refresh();
    });

  const touched = <T,>(fn: (v: T) => void) => (v: T) => (fn(v), setDirty(true));
  const live = a?.status === "live";
  const emailHtml = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${FOOTER}</body>`) : `${html}${FOOTER}`;

  return (
    <div className="adm-ann">
      <form action={save} className="adm-form adm-ann-form">
        {a && <input type="hidden" name="id" value={a.id} />}
        <div className="field">
          <label htmlFor="ann-title">Title</label>
          <input id="ann-title" name="title" className="input" value={title} maxLength={140} onChange={(e) => touched(setTitle)(e.target.value)} placeholder="A new expert joined oovi" />
          <span className="fine">Also the email subject, and the window's name for screen readers.</span>
        </div>

        <fieldset className="adm-fieldset">
          <legend>Channels</legend>
          <label className="check">
            <input type="checkbox" name="window" checked={ch.window} onChange={(e) => touched(setCh)({ ...ch, window: e.target.checked })} /> Window in the app (opens by itself, once per person)
          </label>
          <label className="check">
            <input type="checkbox" name="bar" checked={ch.bar} onChange={(e) => touched(setCh)({ ...ch, bar: e.target.checked })} /> Bar at the top of the app (like the update bar; “Open” shows the window)
          </label>
          <label className="check">
            <input type="checkbox" name="email" checked={ch.email} onChange={(e) => touched(setCh)({ ...ch, email: e.target.checked })} /> Email (with an unsubscribe link; people who unsubscribed are skipped)
          </label>
          <span className="fine">The window and the bar need oovi 0.10.16 or newer; email reaches everyone.</span>
        </fieldset>

        {ch.bar && (
          <div className="field">
            <label htmlFor="ann-bar">Bar text</label>
            <input id="ann-bar" name="barText" className="input" value={barText} maxLength={160} onChange={(e) => touched(setBarText)(e.target.value)} placeholder={title || "New: an expert in marketing joined oovi"} />
            <span className="fine">One short line. Empty = the title.</span>
          </div>
        )}
        {!ch.bar && <input type="hidden" name="barText" value={barText} />}

        <fieldset className="adm-fieldset">
          <legend>Who sees it</legend>
          <label className="check">
            <input type="radio" name="audience" value="test" checked={audience === "test"} onChange={() => touched(setAudience)("test")} /> One person, to test it
          </label>
          {audience === "test" && (
            <input className="input" name="testEmail" type="email" value={testEmail} onChange={(e) => touched(setTestEmail)(e.target.value)} aria-label="Test person's email" style={{ maxWidth: 360 }} />
          )}
          <label className="check">
            <input type="radio" name="audience" value="all" checked={audience === "all"} onChange={() => touched(setAudience)("all")} /> Everyone
          </label>
          <div className="field" style={{ maxWidth: 220 }}>
            <label htmlFor="ann-end">Stop showing it after (optional)</label>
            <input id="ann-end" name="endsOn" type="date" className="input" defaultValue={a?.endsAt?.slice(0, 10) ?? ""} onChange={() => setDirty(true)} />
          </div>
        </fieldset>

        <div className="field">
          <div className="row-actions" style={{ justifyContent: "space-between" }}>
            <label htmlFor="ann-html">HTML</label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => confirm("Replace the HTML with the starter template?") && touched(setHtml)(STARTER)}>
              Starter template
            </button>
          </div>
          <textarea id="ann-html" name="html" className="input adm-mono" rows={18} value={html} onChange={(e) => touched(setHtml)(e.target.value)} spellCheck={false} />
          <span className="fine">
            {(html.length / 1024).toFixed(1)} KB. Scripts are removed and nothing runs; pictures must be online (https://). Links open in the person&apos;s browser. Use inline styles for email.
          </span>
        </div>

        {state?.errors && (
          <ul className="adm-errors" role="alert">
            {state.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div className="row-actions">
          <button className="btn btn-dark" disabled={saving}>
            {saving ? "Saving…" : a ? "Save changes" : "Save draft"}
          </button>
          {state?.ok && !dirty && <span className="fine">{state.ok}{live ? " Live: people see the new version." : ""}</span>}
        </div>
      </form>

      <div className="adm-ann-side">
        <div className="seg adm-seg" role="tablist" aria-label="Preview">
          {(["window", "bar", "email"] as View[]).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? "on" : undefined} onClick={() => setView(v)}>
              {v === "window" ? "Window" : v === "bar" ? "Bar" : "Email"}
            </button>
          ))}
        </div>
        {view === "bar" ? (
          <div className="adm-ann-barprev">
            <span aria-hidden>✦</span> <span dir="auto">{barText || title || "Your bar text"}</span>
            <span className="adm-ann-barbtn">Open</span> <span aria-hidden>✕</span>
          </div>
        ) : (
          <div className={`adm-ann-prev adm-ann-prev-${view}`}>
            <iframe title="Preview" sandbox={FRAME_SANDBOX} srcDoc={framedHtml(view === "email" ? emailHtml : html)} />
          </div>
        )}
        <p className="fine">The preview is exactly what the app shows (same locked frame). Mail apps can differ a little: send yourself a test.</p>

        {a && (
          <div className="adm-ann-actions">
            <p>
              <b>Status:</b> {a.status === "live" ? (a.testEmail ? `Live for ${a.testEmail} only` : "Live for everyone") : a.status === "ended" ? "Ended" : "Draft"}
              {dirty && <span className="fine"> · unsaved changes</span>}
            </p>
            <div className="row-actions" style={{ flexWrap: "wrap" }}>
              {a.status !== "live" && (
                <button className="btn btn-dark btn-sm" disabled={busy || dirty} onClick={() => (a.testEmail || confirm("Make it live for everyone?")) && act(() => changeStatus(a.id, "live"))}>
                  {a.testEmail ? `Go live for ${a.testEmail}` : "Go live for everyone"}
                </button>
              )}
              {a.status === "live" && (
                <button className="btn btn-sm" disabled={busy} onClick={() => act(() => changeStatus(a.id, "ended"))}>
                  End it
                </button>
              )}
              {a.status === "ended" && (
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => changeStatus(a.id, "draft"))}>
                  Back to draft
                </button>
              )}
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => confirm("Delete this announcement and its numbers?") && act(async () => {
                const r = await removeAnn(a.id);
                router.push("/admin/announcements");
                return r;
              })}>
                Delete
              </button>
            </div>

            {a.email && (
              <>
                <p style={{ marginTop: 14 }}>
                  <b>Email:</b> sent to {counts?.sent ?? 0}
                  {counts ? `, ${counts.left} to go` : ""}.
                </p>
                <div className="row-actions" style={{ flexWrap: "wrap" }}>
                  <button className="btn btn-sm" disabled={busy || dirty || (!a.testEmail && !live) || !counts?.left} onClick={() => act(() => sendAnnEmails(a.id))}>
                    {a.testEmail ? `Email ${a.testEmail}` : `Send the next ${Math.min(150, counts?.left ?? 0)} emails`}
                  </button>
                </div>
                {!a.testEmail && !live && <p className="fine">Emails to everyone are sent once it is live.</p>}
              </>
            )}
            <div className="row-actions" style={{ marginTop: 10, flexWrap: "wrap" }}>
              <input className="input" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} aria-label="Send a test email to" style={{ maxWidth: 260 }} />
              <button className="btn btn-ghost btn-sm" disabled={busy || dirty} onClick={() => act(() => sendAnnTest(a.id, testTo))}>
                Send a test email
              </button>
            </div>

            <p style={{ marginTop: 14 }}>
              <b>Numbers:</b> seen by {a.stats.shown ?? 0}, opened from the bar by {a.stats.opened ?? 0}, closed by {a.stats.closed ?? 0}, emailed to {a.stats.emailed ?? 0}.
            </p>
            {msg?.ok && <p className="fine" role="status">{msg.ok}</p>}
            {msg?.errors && (
              <ul className="adm-errors" role="alert">
                {msg.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const FOOTER = `<div style="margin:28px auto 8px;max-width:560px;font:12px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#8a8a8a;text-align:center">You get this because you have an oovi account. <a href="#" style="color:#8a8a8a">Unsubscribe from oovi news</a>.</div>`;
