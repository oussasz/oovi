"use client";

// Settings → Account: what the website's account page had (owner, 2026-11-19: the account information moves to
// Settings). Profile (photo, name, email), password, news by email, delete account. Every change goes through the
// website's own checks: PATCH /api/v1/me, Better Auth's changePassword (current password, other devices signed out)
// and deleteUser (password asked), PATCH /api/v1/account for the news emails.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { getAccount, patchMe, setNewsEmails } from "../_lib/api";
import { photoDataUrl } from "../_lib/image";
import { clearLocal } from "../_lib/local";
import { to } from "../_lib/route";
import type { Account } from "../_lib/types";
import { LargeTitle, MeAvatar, NavBar, OfflineBar, Section, Spinner, Switch } from "./kit";
import { useM } from "./MobileApp";

type Msg = { ok: boolean; text: string } | null;
type Key = Parameters<ReturnType<typeof useM>["t"]>[0];

function Note({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p className={msg.ok ? "m-okay" : "m-alert"} role={msg.ok ? "status" : "alert"}>
      {msg.text}
    </p>
  );
}

export function AccountScreen() {
  const { t, me, updateMe } = useM();
  const [acct, setAcct] = useState<Account | null>(null);
  const [name, setName] = useState(me?.name ?? "");
  const [profileMsg, setProfileMsg] = useState<Msg>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState<Msg>(null);
  const [savingPw, setSavingPw] = useState(false);
  const [newsBusy, setNewsBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletePw, setDeletePw] = useState("");
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    void getAccount()
      .then(setAcct)
      .catch(() => setAcct(null));
  }, []);
  useEffect(() => {
    if (me && !name) setName(me.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const profile = async (body: { name?: string; image?: string | null }, okKey: Key) => {
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      const u = await patchMe(body);
      updateMe(u);
      setName(u.name);
      setProfileMsg({ ok: true, text: t(okKey) });
    } catch (err) {
      setProfileMsg({ ok: false, text: (err as Error).message?.startsWith("acct.") ? t((err as Error).message as Key) : (err as Error).message || t("acct.error") });
    } finally {
      setSavingProfile(false);
    }
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setProfileMsg(null);
    let dataUrl: string;
    try {
      dataUrl = await photoDataUrl(file);
    } catch (err) {
      setProfileMsg({ ok: false, text: t((err as Error).message as Key) });
      return;
    }
    await profile({ image: dataUrl }, "acct.photoSaved");
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    if (newPw.length < 8) return setPwMsg({ ok: false, text: t("acct.pwShort") });
    setSavingPw(true);
    const { error } = await authClient.changePassword({ currentPassword: curPw, newPassword: newPw, revokeOtherSessions: true });
    setSavingPw(false);
    if (error) return setPwMsg({ ok: false, text: /invalid password/i.test(error.message ?? "") ? t("acct.pwWrong") : error.message || t("acct.error") });
    setCurPw("");
    setNewPw("");
    setPwMsg({ ok: true, text: t("acct.pwDone") });
  };

  const deleteAccount = async (e: FormEvent) => {
    e.preventDefault();
    setDeleteMsg(null);
    setDeleting(true);
    const { error } = await authClient.deleteUser({ password: deletePw });
    if (error) {
      setDeleting(false);
      setDeleteMsg(/invalid password/i.test(error.message ?? "") ? t("acct.deleteWrong") : error.message || t("acct.error"));
      return;
    }
    await clearLocal();
    window.location.replace("/?deleted=1");
  };

  const toggleNews = async (on: boolean) => {
    if (!acct) return;
    setNewsBusy(true);
    setAcct({ ...acct, news: on });
    try {
      await setNewsEmails(on);
    } catch {
      setAcct({ ...acct, news: !on });
    } finally {
      setNewsBusy(false);
    }
  };

  return (
    <div className="m-screen m-screen--grouped">
      <NavBar title={t("acct.title")} large back={{ href: to("/settings"), label: t("settings.title") }} />
      <main className="m-main">
        <LargeTitle>{t("acct.title")}</LargeTitle>
        <OfflineBar />

        <Section header={t("acct.profile")} id="acct-profile">
          <div className="m-photo">
            <MeAvatar size={72} />
            <div className="m-photo__acts">
              <button type="button" className="m-btn m-btn--gray m-btn--sm" onClick={() => fileRef.current?.click()} disabled={savingProfile}>
                {me?.image ? t("acct.photoChange") : t("acct.photoAdd")}
              </button>
              {me?.image && (
                <button type="button" className="m-btn m-btn--plain m-btn--sm" onClick={() => void profile({ image: null }, "acct.photoRemoved")} disabled={savingProfile}>
                  {t("acct.photoRemove")}
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => (void onPhoto(e.target.files?.[0]), (e.target.value = ""))} />
            </div>
          </div>
          <form
            className="m-form"
            onSubmit={(e) => {
              e.preventDefault();
              void profile({ name: name.trim() }, "acct.saved");
            }}
          >
            <label className="m-field">
              <span>{t("acct.name")}</span>
              <input dir="auto" maxLength={80} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="m-field">
              <span>{t("acct.email")}</span>
              <input dir="ltr" value={me?.email ?? ""} readOnly aria-label={t("acct.email")} />
            </div>
            <div className="m-form__foot">
              <Note msg={profileMsg} />
              <button type="submit" className="m-btn m-btn--fill m-btn--sm" disabled={savingProfile || !name.trim() || name.trim() === me?.name}>
                {savingProfile ? <Spinner size={16} /> : t("acct.save")}
              </button>
            </div>
          </form>
        </Section>

        <Section header={t("acct.password")} id="acct-pw">
          <form className="m-form" onSubmit={(e) => void changePassword(e)}>
            <label className="m-field">
              <span>{t("acct.pwCurrent")}</span>
              <input type="password" autoComplete="current-password" dir="ltr" value={curPw} onChange={(e) => setCurPw(e.target.value)} />
            </label>
            <label className="m-field">
              <span>{t("acct.pwNew")}</span>
              <input type="password" autoComplete="new-password" dir="ltr" maxLength={128} value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            </label>
            <div className="m-form__foot">
              <Note msg={pwMsg} />
              <button type="submit" className="m-btn m-btn--fill m-btn--sm" disabled={savingPw || !curPw || !newPw}>
                {savingPw ? <Spinner size={16} /> : t("acct.pwChange")}
              </button>
            </div>
          </form>
        </Section>

        <Section header={t("acct.news")} footer={t("acct.newsNote")} id="acct-news">
          <div className="m-row">
            <span className="m-row__main">
              <span className="m-row__title">{t("acct.news")}</span>
              <span className="m-row__sub">{t("acct.newsSub")}</span>
            </span>
            {acct ? <Switch on={acct.news} onChange={(v) => void toggleNews(v)} label={t("acct.news")} disabled={newsBusy} /> : <Spinner size={16} />}
          </div>
        </Section>

        <Section header={t("acct.delete")} id="acct-delete">
          {!confirmDelete ? (
            <button type="button" className="m-row is-tap" onClick={() => setConfirmDelete(true)}>
              <span className="m-row__main">
                <span className="m-row__title is-danger">{t("acct.delete")}</span>
              </span>
            </button>
          ) : (
            <form className="m-form" onSubmit={(e) => void deleteAccount(e)}>
              <p className="m-form__text">{t("acct.deleteWarn")}</p>
              <label className="m-field m-field--key">
                <span>{t("acct.deletePw")}</span>
                <input type="password" autoComplete="current-password" dir="ltr" value={deletePw} onChange={(e) => setDeletePw(e.target.value)} />
              </label>
              <div className="m-form__foot">
                {deleteMsg && (
                  <p className="m-alert" role="alert">
                    {deleteMsg}
                  </p>
                )}
                <button type="button" className="m-btn m-btn--gray m-btn--sm" onClick={() => (setConfirmDelete(false), setDeletePw(""), setDeleteMsg(null))}>
                  {t("common.cancel")}
                </button>
                <button type="submit" className="m-btn m-btn--danger m-btn--sm" disabled={deleting || !deletePw}>
                  {deleting ? <Spinner size={16} /> : t("acct.deleteGo")}
                </button>
              </div>
            </form>
          )}
        </Section>
      </main>
    </div>
  );
}
