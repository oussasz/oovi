import type { Verdict } from "@/lib/user-signals";

/** A small badge for "does this account look like a person?". A hint only: hover for the reasons. */
export function VerdictBadge({ v }: { v: Verdict | null }) {
  if (!v) return <span>–</span>;
  const title = v.reasons.length ? v.reasons.join("\n") : "Nothing unusual.";
  if (v.level === "suspicious")
    return (
      <span className="adm-badge warn" title={title}>
        Suspicious
      </span>
    );
  if (v.level === "watch")
    return (
      <span className="adm-badge" title={title}>
        Watch
      </span>
    );
  return (
    <span className="adm-badge on" title={title}>
      Normal
    </span>
  );
}
