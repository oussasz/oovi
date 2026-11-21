// A long skill reaches the bot whole, a part at a time. A skill put in a bot's instructions was cut at 4,000
// characters with nothing saying more existed (284 of the 326 library skills are longer: median 11,464), so the
// bot followed half a procedure. Now it gets the opening, then the list of the skill's sections, and loads the
// one it needs with use_skill {name, section}: the whole skill is reachable, and only what is used is paid for.
// Sections are the skill's "## " headings (every library skill has them). Pure: tests/unit/skill-sections.test.mts.

/** What a skill may take in a bot's instructions (the opening plus the list of sections). */
export const PROMPT_SKILL_MAX = 4000;
/** One part loaded with use_skill: a section longer than this comes in parts. */
export const SECTION_MAX = 8000;
/** A whole skill this short comes back from use_skill at once. */
export const WHOLE_MAX = 12_000;

export type SkillSection = { title: string; text: string };

/** The skill's sections ("## " headings), in order, with their text (heading line included). */
export function skillSections(body: string): SkillSection[] {
  const parts = body.split(/^(?=## )/m);
  return parts
    .slice(1)
    .map((p) => ({ title: (/^## +(.*)$/m.exec(p)?.[1] ?? "").trim(), text: p.trim() }))
    .filter((s) => s.title);
}

/** Text up to `max` characters, ended at a line break, never in the middle of a line. */
function headOf(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf("\n", max);
  return text.slice(0, cut > max / 2 ? cut : max).trimEnd();
}

function indexLine(name: string, list: SkillSection[], from: number): string {
  const rest = list.slice(from).map((s, i) => `${from + i + 1}. ${s.title}`);
  return `(This skill continues. Its other sections: ${rest.join(" · ")}. Load the one you need with use_skill {"name": "${name}", "section": "<number or title>"}.)`;
}

/** The skill as it goes into a bot's instructions: whole when short; else its opening and the list of what follows. */
export function skillForPrompt(name: string, body: string, max = PROMPT_SKILL_MAX): string {
  if (body.length <= max) return body;
  const list = skillSections(body);
  const opening = body.split(/^(?=## )/m)[0]!.trim();
  // The opening, then as many whole sections as fit with room left for the list of the rest.
  let out = headOf(opening, Math.floor(max * 0.6));
  let shown = 0;
  for (const s of list) {
    const index = indexLine(name, list, shown + 1);
    if (out.length + s.text.length + index.length + 2 > max) break;
    out += `\n\n${s.text}`;
    shown++;
  }
  if (shown >= list.length) return out;
  return `${out}\n\n${indexLine(name, list, shown)}`;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * One section, by its number ("3") or words of its title ("first line"); "<title> part 2" for the next part of a
 * section longer than SECTION_MAX. null when nothing matches.
 */
export function skillSection(body: string, wanted: string): SkillSection | null {
  const list = skillSections(body);
  const w = String(wanted ?? "").trim();
  const partM = /\bpart\s+(\d+)\s*$/i.exec(w);
  const part = partM ? Math.max(1, Number(partM[1])) : 1;
  const q = norm(partM ? w.slice(0, partM.index) : w);
  if (!q) return null;
  let s: SkillSection | undefined;
  if (/^\d+$/.test(q)) s = list[Number(q) - 1];
  else {
    const words = q.split(" ");
    s = list.find((x) => norm(x.title) === q) ?? list.find((x) => words.every((wd) => norm(x.title).includes(wd)));
  }
  if (!s) return null;
  if (s.text.length <= SECTION_MAX) return s;
  // A long section in parts, each ended at a line break.
  const parts: string[] = [];
  let rest = s.text;
  while (rest.length) {
    const head = headOf(rest, SECTION_MAX);
    parts.push(head);
    rest = rest.slice(head.length).trimStart();
  }
  const k = Math.min(part, parts.length);
  const more = k < parts.length ? ` Load part ${k + 1} with section "${s.title} part ${k + 1}".` : "";
  return { title: s.title, text: `(Section "${s.title}", part ${k} of ${parts.length}.${more})\n\n${parts[k - 1]}` };
}

/** What use_skill returns: the whole skill when short; else the opening, the list, or the section asked for. */
export function skillForTool(name: string, body: string, section?: string): string {
  if (section && String(section).trim()) {
    const s = skillSection(body, section);
    if (s) return s.text;
    const list = skillSections(body);
    return `No section "${section}" in this skill. Its sections: ${list.map((x, i) => `${i + 1}. ${x.title}`).join(" · ")}.`;
  }
  if (body.length <= WHOLE_MAX) return body;
  return skillForPrompt(name, body, SECTION_MAX);
}
