import Face, { FaceStack } from "@/components/Face";
import logos from "@/lib/builtin-logos.json";

const LOGOS = logos as Record<string, string>;
const TILE = ["#A9BCF7", "#FDDA80", "#FF9F86", "#BBD8C4", "#CDBFEA", "#EDB9BB"];

/** What an item looks like in the app: an expert's or a team's faces, a connector's logo, a letter for a skill. */
export function CatalogPicture({ id, kind, data, size = 44 }: { id: string; kind: string; data: Record<string, unknown>; size?: number }) {
  const name = typeof data.name === "string" ? data.name : id;
  if (kind === "plugin" && Array.isArray(data.bots) && data.bots.length) {
    const faces = (data.bots as { face?: Record<string, unknown> }[]).map((b) => b.face ?? {});
    return <span className="adm-pic">{faces.length === 1 ? <Face face={faces[0]!} size={size} /> : <FaceStack faces={faces.slice(0, 4)} size={size} />}</span>;
  }
  const own = typeof data.logo === "string" && data.logo.startsWith("https://") ? data.logo : null;
  const src = kind === "connector" ? (own ?? LOGOS[id] ?? null) : null;
  if (src) {
    return (
      <span className="adm-pic">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" className="adm-logo" />
      </span>
    );
  }
  const colour = TILE[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % TILE.length];
  return (
    <span className="adm-pic">
      <span className="adm-tile" style={{ width: size, height: size, background: colour }} aria-hidden="true">
        {name.trim().charAt(0).toUpperCase() || "?"}
      </span>
    </span>
  );
}
