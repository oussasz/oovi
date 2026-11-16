"use client";

// A bot's face in the Marketplace editor: the same slime the app draws (components/Face.tsx is a copy of
// the app's), picked by clicking, or a picture uploaded by the admin. The picture is resized here to fit
// 256 px (PNG) before it is sent; the server checks it again. The slime parts are kept under a picture:
// older apps, and any app that can't load the picture, show that slime.
import { useRef, useState, useTransition } from "react";
import Face from "@/components/Face";
import { CHEEKS, EYES, FACE_COLORS, HAIR, MOUTHS, NOSES, SHAPES, TOPS, WEAR, normalizeFace, randomFace, slimeOf, type Face as FaceT } from "@/lib/faces";

const PARTS: { key: Exclude<keyof FaceT, "color" | "image">; label: string; list: readonly string[] }[] = [
  { key: "shape", label: "Body", list: SHAPES },
  { key: "hair", label: "Hair", list: HAIR },
  { key: "eyes", label: "Eyes", list: EYES },
  { key: "nose", label: "Nose", list: NOSES },
  { key: "mouth", label: "Mouth", list: MOUTHS },
  { key: "cheeks", label: "Cheeks", list: CHEEKS },
  { key: "top", label: "On the head", list: TOPS },
  { key: "wear", label: "On the face", list: WEAR },
];
const MAX_INPUT = 5 * 1024 * 1024;
const SIDE = 256;

/** The picture made to fit SIDE×SIDE (aspect kept, nothing cropped), as a PNG data URL. */
async function toPng(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => bad(new Error("unreadable"));
      i.src = url;
    });
    const k = Math.min(1, SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("unreadable");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function FacePicker({ id, value, onChange, upload }: { id: string; value: unknown; onChange: (f: FaceT) => void; upload: (dataUrl: string) => Promise<{ id?: string; error?: string }> }) {
  const face = normalizeFace(value);
  const slime = slimeOf(face);
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [busy, start] = useTransition();
  // A slime choice keeps the picture (it is the fallback); the preview shows the slime being edited.
  const [showSlime, setShowSlime] = useState(false);
  const setPart = (p: Partial<FaceT>) => {
    setShowSlime(true);
    onChange({ ...face, ...p });
  };

  const pick = (f: File | undefined) => {
    setError("");
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return setError("Use a PNG, JPG or WebP image.");
    if (f.size > MAX_INPUT) return setError("That file is over 5 MB. Use a smaller image.");
    start(async () => {
      try {
        const r = await upload(await toPng(f));
        if (r.error || !r.id) return setError(r.error ?? "The picture could not be saved.");
        setShowSlime(false);
        onChange({ ...face, image: r.id });
      } catch {
        setError("The picture could not be read or saved. Try another file.");
      }
    });
  };

  const preview = showSlime ? slime : face;
  return (
    <details className="adm-face-picker">
      <summary>
        <Face face={face} size={44} />
        <span>
          <b>Face</b>
          <span className="fine">{face.image ? " · picture (the slime shows in older apps)" : " · slime"} · click to change</span>
        </span>
      </summary>
      <div className="adm-face-body">
        <div className="adm-face-side">
          <Face face={preview} size={140} mood="happy" interactive />
          {face.image && (
            <div className="seg adm-seg" role="group" aria-label="Preview">
              <button type="button" className={!showSlime ? "on" : undefined} onClick={() => setShowSlime(false)}>
                Picture
              </button>
              <button type="button" className={showSlime ? "on" : undefined} onClick={() => setShowSlime(true)}>
                Fallback slime
              </button>
            </div>
          )}
          <input ref={file} id={`${id}-file`} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              pick(f);
            }} />
          <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => file.current?.click()}>
            {busy ? "Uploading…" : face.image ? "Change the picture" : "Upload a picture"}
          </button>
          {face.image && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => (setShowSlime(false), onChange(slime))}>
              Remove the picture
            </button>
          )}
          <button type="button" className="btn btn-light btn-sm" onClick={() => setPart({ ...randomFace(), ...(face.image ? { image: face.image } : {}) })}>
            Random slime
          </button>
          <span className="fine">PNG with a transparent background looks best. It is made to fit 256 px.</span>
          {error && (
            <span className="fine" role="alert" style={{ color: "var(--coral-ink, #b42318)" }}>
              {error}
            </span>
          )}
        </div>
        <div className="adm-face-parts">
          <div className="adm-face-group">
            <div className="fine">
              <b>Color</b>
            </div>
            <div className="adm-face-grid">
              {FACE_COLORS.map((c, i) => (
                <button key={c} type="button" className={`adm-swatch${face.color === i ? " on" : ""}`} style={{ background: c }} onClick={() => setPart({ color: i })} aria-label={`Color ${i + 1}`} aria-pressed={face.color === i} />
              ))}
            </div>
          </div>
          {PARTS.map((p) => (
            <div key={p.key} className="adm-face-group">
              <div className="fine">
                <b>{p.label}</b>
              </div>
              <div className="adm-face-grid">
                {p.list.map((name, i) => (
                  <button key={name} type="button" className={`adm-face-opt${face[p.key] === i ? " on" : ""}`} onClick={() => setPart({ [p.key]: i })} title={name} aria-label={`${p.label}: ${name}`} aria-pressed={face[p.key] === i}>
                    <Face face={{ ...slime, [p.key]: i, ...(p.key === "hair" ? { top: 0 } : p.key === "eyes" ? { wear: 0 } : {}) }} size={40} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
