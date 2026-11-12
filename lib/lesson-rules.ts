// What may never be saved as a lesson or in memory. Pure: no imports, so memory, learning and tests share it.

/**
 * Lessons known to be wrong, saved by older versions (and never again, as a lesson or in memory): a slow page taken for a site that's down
 * ("the tunnel is likely down, ask the owner to restart instead of retrying"). They made bots give up
 * on pages that only needed more time, so they're dropped on read.
 */
export const WRONG_LESSON = /(empty|blank|vide)[^.]*(tunnel|offline|down|hors ligne|coup[ée])|tunnel[^.]*(is |est )?(likely |probablement )?(down|offline|coup[ée]|hors ligne)/i;

/**
 * A "lesson" that is really a note about how oovi's own tools behaved: tool names, snippets, pages that
 * didn't load, errors, retries. Users saw the Learned card fill with these; they aren't about the user's
 * work, and some were wrong conclusions. Not saved from the automatic review (a lesson the user wrote
 * themselves with thumbs-down is kept as they wrote it).
 */
export const TECHNICAL_LESSON =
  /\b(web_search|read_url|open_url|read_page|extract_list|research tool|work_table|work_notes|work_export|create_(document|spreadsheet|presentation|image)|request_user_takeover|message_group|send_file_to_user|find_files|vm_run|mcp_\w+|tool call|tool result|api (error|call|limit)|rate limit|time[d ]?out|timeout|status code|http \d{3}|\b[45]\d{2} error|json|javascript|snippets?|extraits? de recherche|headless|selector|element number|step limit|hand-?offs?|token limit|context window|retry|retries|réessay)/i;

/**
 * A note for oovi's developers about how one of oovi's tools behaved ("read_url returned no phone
 * numbers on dzadvisor.com listing pages"). It leaves the user's computer, so anything personal is
 * taken out first: emails, phone numbers and long numbers, file paths, quoted text, and addresses are
 * cut down to the site's name. Returns "" when nothing useful is left.
 */
export function cleanToolNote(text: string): string {
  let t = String(text ?? "").replace(/\s+/g, " ").trim();
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]");
  t = t.replace(/https?:\/\/([\w.-]+)[^\s)"']*/gi, "$1"); // the site, not the page (a page address can hold a search or a name)
  // A file path, with spaces in it, up to its extension when it has one.
  t = t.replace(/(?:[A-Za-z]:\\|\/(?:home|Users)\/)(?:[^"'\n]*?\.[A-Za-z0-9]{2,5}\b|[^\s"']+)/g, "[path]");
  t = t.replace(/["“«][^"”»]{12,}["”»]/g, "[text]");
  t = t.replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]");
  t = t.slice(0, 300).trim();
  return t.length >= 15 && TECHNICAL_LESSON.test(t) ? t : "";
}

/**
 * A "lesson" that takes an ability away from the bots. One was saved from a conversation where the user
 * said "don't use your browser, use control of my PC": "The user does not want the bots to control their
 * PC or browser. Don't use desktop_screenshot or click/type on the screen." It is the opposite of what
 * the user wanted, and it would have made every bot refuse from then on. The automatic review can't be
 * trusted with bans: it never saves one, and those it saved before are dropped. (A ban the user really
 * wants is kept when they write it themselves: thumbs-down with a note, or "remember: never…".)
 */
const ABILITY_WORD =
  /(desktop|screen|mouse|keyboard|\bpc\b|computer|browser|brave|chrome|firefox|edge|click|control|screenshot|\btools?\b|web ?search|ordinateur|navigateur|souris|clavier|écran|ecran|contr[ôo]l|outils?|الحاسوب|الكمبيوتر|المتصفح|الفأرة|لوحة المفاتيح|الشاشة|التحكم)/i;
const BAN_WORD =
  /(does(?:n't|n’t| not) want|do(?:n't|n’t| not) (?:use|control|click|type|open|take|touch)|never (?:use|control|click|type|open|touch)|not allowed|must not|mustn't|should not|shouldn't|avoid (?:using|the|any)|stop using|no longer (?:use|wants?)|refuses? (?:that|to let)|ne (?:veut|souhaite) (?:pas|plus)|ne (?:pas|jamais|plus) (?:utiliser|contr[ôo]ler|ouvrir|cliquer|toucher)|n['’]utilise[zr]? (?:pas|jamais|plus)|interdit|لا يريد|لا تستخدم|لا تتحكم|ممنوع)/i;
export const bansAbility = (text: string): boolean => ABILITY_WORD.test(text) && BAN_WORD.test(text);
