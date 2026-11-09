"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";
import type { PublicUser } from "@/lib/api";
import { DownloadButton } from "@/components/download/DownloadButton";
import { Slime } from "@/components/Slime";
import { CloseIcon } from "@/components/icons";

const MAX_IMAGE = 200 * 1024;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image."));
    };
    img.src = url;
  });
}

/** Center-crops to a square and resizes to max 256x256. Returns a data URL <= 200 KB. */
async function resizeImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file.");
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const out = Math.min(256, side);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser can't process images.");
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  if (file.type === "image/png") {
    ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
    const png = canvas.toDataURL("image/png");
    if (png.length <= MAX_IMAGE) return png;
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out, out);
  ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
  for (const q of [0.9, 0.8, 0.7, 0.55, 0.4]) {
    const jpg = canvas.toDataURL("image/jpeg", q);
    if (jpg.length <= MAX_IMAGE) return jpg;
  }
  throw new Error("That image is too large, please try another one.");
}

async function patchMe(body: { name?: string; image?: string | null }): Promise<PublicUser> {
  const res = await fetch("/api/v1/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not save your changes.");
  return data.user as PublicUser;
}

type Msg = { kind: "ok" | "error"; text: string } | null;

export function AccountClient({
  user: initialUser,
  welcome,
  credits = null,
  notice = null,
}: {
  user: PublicUser;
  welcome: boolean;
  /** theOovi credits card, rendered on the server. */
  credits?: ReactNode;
  /** "Confirm your email" reminder, when it applies. */
  notice?: ReactNode;
}) {
  const router = useRouter();
  const [user, setUser] = useState(initialUser);
  const [name, setName] = useState(initialUser.name);
  const [profileMsg, setProfileMsg] = useState<Msg>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState<Msg>(null);
  const [savingPw, setSavingPw] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletePw, setDeletePw] = useState("");
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      const u = await patchMe({ name: name.trim() });
      setUser(u);
      setName(u.name);
      setProfileMsg({ kind: "ok", text: "Saved." });
    } catch (err) {
      setProfileMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setSavingProfile(false);
    }
  }

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      const dataUrl = await resizeImage(file);
      const u = await patchMe({ image: dataUrl });
      setUser(u);
      setProfileMsg({ kind: "ok", text: "Profile photo updated." });
    } catch (err) {
      setProfileMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setSavingProfile(false);
    }
  }

  async function removePhoto() {
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      const u = await patchMe({ image: null });
      setUser(u);
      setProfileMsg({ kind: "ok", text: "Profile photo removed." });
    } catch (err) {
      setProfileMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (newPw.length < 8) return setPwMsg({ kind: "error", text: "New password must be at least 8 characters." });
    setSavingPw(true);
    const { error } = await authClient.changePassword({
      currentPassword: currentPw,
      newPassword: newPw,
      revokeOtherSessions: true,
    });
    setSavingPw(false);
    if (error) {
      setPwMsg({
        kind: "error",
        text: /invalid password/i.test(error.message ?? "") ? "Your current password is incorrect." : error.message || "Could not change password.",
      });
      return;
    }
    setCurrentPw("");
    setNewPw("");
    setPwMsg({ kind: "ok", text: "Password changed. Other devices were signed out." });
  }

  async function signOut() {
    await authClient.signOut();
    router.replace("/");
    router.refresh();
  }

  async function deleteAccount(e: FormEvent) {
    e.preventDefault();
    setDeleteMsg(null);
    setDeleting(true);
    const { error } = await authClient.deleteUser({ password: deletePw });
    if (error) {
      setDeleting(false);
      setDeleteMsg(/invalid password/i.test(error.message ?? "") ? "That password is incorrect." : error.message || "Could not delete your account.");
      return;
    }
    router.replace("/?deleted=1");
    router.refresh();
  }

  return (
    <>
      <div className="page-head">
        <span className="tag">
          <span className="tag-dot" style={{ background: "#BBD8C4" }} /> Signed in as {user.email}
        </span>
        <h1 className="h2">Hi, {user.name.split(" ")[0] || "there"}!</h1>
        {welcome && <p className="alert alert-ok">Your account is ready. Welcome to oovi!</p>}
        {notice}
      </div>

      <div className="account-grid">
        <div className="account-col">
          {credits}
          <section className="card desktop-card">
            <div style={{ display: "flex", gap: 6, alignItems: "flex-end", marginBottom: 14 }} aria-hidden>
              <Slime color="blue" shape="egg" face="dash" size={50} />
              <Slime color="yellow" shape="round" face="smile" size={44} delay={0.5} />
              <Slime color="coral" shape="lump" face="happy" size={46} delay={1} />
            </div>
            <h2>oovi runs on your computer.</h2>
            <p className="muted" style={{ marginBottom: 18 }}>
              Download it and sign in with this account. Your bots, chats and keys live on your device, not here.
            </p>
            <div className="cta-row">
              <DownloadButton os="mac">Download for Mac</DownloadButton>
              <DownloadButton os="windows" variant="light">Download for Windows</DownloadButton>
            </div>
          </section>

          <section className="card">
            <div className="soon" aria-disabled="true">
              <div>
                <h2 style={{ marginBottom: 4 }}>
                  Backup &amp; sync across devices <span className="pill-soon">Coming soon</span>
                </h2>
                <p className="muted">Keep your team in sync on all your computers. Free with every oovi account.</p>
              </div>
              <span className="toggle" role="switch" aria-checked="false" aria-disabled="true" aria-label="Backup and sync (coming soon)" />
            </div>
          </section>

          <section className="card danger-zone">
            <h2>Sign out or delete account</h2>
            <div className="row-actions" style={{ marginBottom: confirmDelete ? 18 : 0 }}>
              <button type="button" className="btn btn-ghost btn-md" onClick={signOut}>
                Sign out
              </button>
              {!confirmDelete && (
                <button type="button" className="btn btn-danger btn-md" onClick={() => setConfirmDelete(true)}>
                  Delete account
                </button>
              )}
            </div>
            {confirmDelete && (
              <form className="form" onSubmit={deleteAccount}>
                <p className="muted">
                  This permanently deletes your oovi account, profile and any crash reports linked to it. Data stored in
                  the app on your computer is not affected. This can’t be undone.
                </p>
                {deleteMsg && <p className="alert alert-error" role="alert">{deleteMsg}</p>}
                <div className="field">
                  <label htmlFor="delete-pw">Enter your password to confirm</label>
                  <input
                    id="delete-pw"
                    className="input"
                    type="password"
                    autoComplete="current-password"
                    value={deletePw}
                    onChange={(e) => setDeletePw(e.target.value)}
                  />
                </div>
                <div className="row-actions">
                  <button type="submit" className="btn btn-danger btn-md" disabled={deleting || !deletePw} style={{ width: "auto" }}>
                    {deleting ? "Deleting…" : "Permanently delete my account"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-md"
                    style={{ width: "auto" }}
                    onClick={() => {
                      setConfirmDelete(false);
                      setDeletePw("");
                      setDeleteMsg(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>

        <div className="account-col">
          <section className="card">
            <h2>Profile</h2>
            <div className="avatar-row">
              <div className="avatar">
                {user.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.image} alt="Your profile photo" />
                ) : (
                  <Slime color="lilac" shape="drop" face="dash" size={60} />
                )}
              </div>
              <div className="avatar-actions">
                <button type="button" className="btn btn-light btn-sm" onClick={() => fileRef.current?.click()} disabled={savingProfile}>
                  {user.image ? "Change photo" : "Upload photo"}
                </button>
                {user.image && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={removePhoto} disabled={savingProfile}>
                    <CloseIcon size={14} /> Remove
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onPhoto} />
              </div>
            </div>
            <form className="form" onSubmit={saveName}>
              <div className="field">
                <label htmlFor="name">Name</label>
                <input id="name" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <span className="label">Email</span>
                <input className="input" value={user.email} disabled readOnly />
              </div>
              {profileMsg && (
                <p className={`alert ${profileMsg.kind === "ok" ? "alert-ok" : "alert-error"}`} role="status">
                  {profileMsg.text}
                </p>
              )}
              <button type="submit" className="btn btn-dark btn-md" disabled={savingProfile || !name.trim() || name.trim() === user.name}>
                {savingProfile ? "Saving…" : "Save changes"}
              </button>
            </form>
          </section>

          <section className="card">
            <h2>Change password</h2>
            <form className="form" onSubmit={changePassword}>
              <div className="field">
                <label htmlFor="cur-pw">Current password</label>
                <input id="cur-pw" className="input" type="password" autoComplete="current-password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="new-pw">New password</label>
                <input id="new-pw" className="input" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={newPw} onChange={(e) => setNewPw(e.target.value)} />
              </div>
              {pwMsg && (
                <p className={`alert ${pwMsg.kind === "ok" ? "alert-ok" : "alert-error"}`} role="status">
                  {pwMsg.text}
                </p>
              )}
              <button type="submit" className="btn btn-dark btn-md" disabled={savingPw || !currentPw || !newPw}>
                {savingPw ? "Changing…" : "Change password"}
              </button>
            </form>
          </section>
        </div>
      </div>
    </>
  );
}
