import { CALL, FACES, HEARD, IMPROVE, LANGUAGES, MOBILE, PAY, PAY_METHODS, SYSTEMS, TOOLS, USES, labelOf, labelsOf, type PilotAnswers } from "@/lib/pilot-form";

/** What one person answered on the pilot form, shown under their request. Older requests have none. */
export function PilotAnswersView({ a, useCase }: { a: PilotAnswers | null; useCase?: string }) {
  if (!a || !a.role) return null;
  const face = FACES.find((f) => f.value === a.experience);
  const heard = a.heard === "other" && a.heardOther ? `${labelOf(HEARD, "other")}: ${a.heardOther}` : labelOf(HEARD, a.heard);
  const call = a.call ? `${labelOf(CALL, a.call)}${a.contact ? ` · ${a.contact}` : ""}` : "–";
  const rows: [string, string][] = [
    ["Computer", labelOf(SYSTEMS, a.system)],
    ["Uses oovi for", labelsOf(USES, a.uses)],
    ["Languages", labelsOf(LANGUAGES, a.languages)],
    ["Uses today", labelsOf(TOOLS, a.tools)],
    ["Heard from", heard],
    ["First try", face ? `${face.icon} ${face.label}` : "–"],
    ["Improve first", labelsOf(IMPROVE, a.improve)],
    ["Can pay with", labelsOf(PAY_METHODS, a.payMethods)],
    ["Would pay", a.pay ? labelOf(PAY, a.pay) : "–"],
    ["On the phone", a.mobile ? labelOf(MOBILE, a.mobile) : "–"],
    ["A 15 minute call", call],
    ["May quote them", a.quote ? "Yes, without their name" : "No answer"],
  ];
  return (
    <div className="adm-answers">
      <dl className="adm-dl adm-dl-inline">
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {a.extra && a.extra !== useCase && <p className="adm-quote">{a.extra}</p>}
    </div>
  );
}
