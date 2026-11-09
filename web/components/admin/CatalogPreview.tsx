import { isHttpsUrl, type CatalogKind } from "@/lib/catalog";

// Same palette as the desktop app's slime faces (lib/faces.ts FACE_COLORS).
const FACE_COLORS = ["#A9BCF7", "#FDDA80", "#FF9F86", "#D8D5A6", "#E5B08C", "#EDB9BB", "#E4E4E0", "#BBD8C4", "#CDBFEA"];

type Obj = Record<string, unknown>;
const s = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});

function Chip({ children, on }: { children: React.ReactNode; on?: boolean }) {
  return <span className={`adm-badge${on ? " on" : ""}`}>{children}</span>;
}

function Connector({ d }: { d: Obj }) {
  const name = s(d.name, "Untitled");
  const logo = s(d.logo);
  const soon = d.soon === true ? "Coming soon" : s(d.soon);
  const fields = arr(d.fields).map(obj);
  return (
    <div className="adm-preview-card">
      <div className="adm-preview-head">
        <span className="adm-preview-logo" aria-hidden>
          {logo && isHttpsUrl(logo) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" referrerPolicy="no-referrer" />
          ) : (
            name.slice(0, 1).toUpperCase()
          )}
        </span>
        <div>
          <h3>{name}</h3>
          <p className="fine">by {s(d.by, "–")}</p>
        </div>
      </div>
      <div className="adm-chips">
        {d.verified === true && <Chip on>Verified</Chip>}
        <Chip>{s(d.category, "no category")}</Chip>
        <Chip>{s(d.transport, "?")}</Chip>
        {d.oauth === true && <Chip>Sign in with browser</Chip>}
        {d.needsNode === true && <Chip>Needs Node.js</Chip>}
      </div>
      <p>{s(d.description)}</p>
      {soon && <p className="alert alert-error">{soon}</p>}
      {d.url !== undefined && <p className="fine adm-mono" style={{ overflowWrap: "anywhere" }}>{s(d.url)}</p>}
      {d.command !== undefined && (
        <p className="fine adm-mono" style={{ overflowWrap: "anywhere" }}>
          {[s(d.command), ...arr(d.args).map((a) => s(a))].join(" ")}
        </p>
      )}
      {fields.length > 0 && (
        <div>
          <p className="label">Asks the user for</p>
          <ul className="adm-bots" style={{ marginTop: 6 }}>
            {fields.map((f, i) => (
              <li key={i}>
                <span>
                  <b>{s(f.label, s(f.key))}</b>
                  {f.optional === true && <span className="fine"> (optional)</span>}
                  {f.secret === true && <span className="fine"> · secret</span>}
                  <span className="fine">
                    {" "}
                    → {s(f.to)}
                    {f.name ? ` ${s(f.name)}` : ""}
                  </span>
                  {f.help ? <span className="fine"> · {s(f.help)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.docs !== undefined && <p className="fine">Docs: {s(d.docs)}</p>}
    </div>
  );
}

function Skill({ d }: { d: Obj }) {
  const body = s(d.body);
  return (
    <div className="adm-preview-card">
      <h3>{s(d.name, "Untitled")}</h3>
      <div className="adm-chips">
        <Chip>{s(d.category, "no category")}</Chip>
        <Chip>{body.length.toLocaleString("en-US")} characters</Chip>
      </div>
      <p>{s(d.description)}</p>
      <pre className="adm-pre">{body.length > 1500 ? `${body.slice(0, 1500)}…` : body}</pre>
    </div>
  );
}

function Plugin({ d }: { d: Obj }) {
  const bots = arr(d.bots).map(obj);
  const skills = arr(d.skills).map((x) => s(x));
  const connectors = arr(d.connectors).map((x) => s(x));
  return (
    <div className="adm-preview-card">
      <h3>{s(d.name, "Untitled")}</h3>
      <p className="fine">Works in the group “{s(d.group, "–")}”{d.usesFolder === true ? " · uses a project folder" : ""}</p>
      <p>{s(d.description)}</p>
      <ul className="adm-bots">
        {bots.map((b, i) => {
          const face = obj(b.face);
          const tools = obj(b.tools);
          const color = FACE_COLORS[Number(face.color)] ?? FACE_COLORS[0];
          const toolNames = [tools.web === true && "web", tools.browser === true && "browser", tools.accounts === true && "accounts"].filter(Boolean);
          return (
            <li key={i}>
              <span className="adm-face" style={{ background: color }} aria-hidden />
              <span>
                <b>{s(b.name, "?")}</b> <span className="fine">{s(b.role)}</span>
                {b.lead === true && (
                  <>
                    {" "}
                    <Chip on>Lead</Chip>
                  </>
                )}
                <br />
                <span className="fine">Tools: {toolNames.length ? toolNames.join(", ") : "none"}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {skills.length > 0 && (
        <div className="adm-chips">
          <span className="fine">Skills:</span>
          {skills.map((x, i) => (
            <Chip key={`${x}-${i}`}>{x}</Chip>
          ))}
        </div>
      )}
      {connectors.length > 0 && (
        <div className="adm-chips">
          <span className="fine">Suggested connectors:</span>
          {connectors.map((x, i) => (
            <Chip key={`${x}-${i}`}>{x}</Chip>
          ))}
        </div>
      )}
    </div>
  );
}

/** A readable card for the item, roughly as the app shows it. Tolerates invalid data. */
export function CatalogPreview({ kind, data }: { kind: CatalogKind; data: Obj }) {
  if (kind === "connector") return <Connector d={data} />;
  if (kind === "skill") return <Skill d={data} />;
  return <Plugin d={data} />;
}
