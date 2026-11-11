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
  /\b(web_search|read_url|open_url|read_page|research tool|work_table|work_notes|work_export|create_(document|spreadsheet|presentation|image)|request_user_takeover|message_group|send_file_to_user|find_files|vm_run|mcp_\w+|tool call|tool result|api (error|call|limit)|rate limit|time[d ]?out|timeout|status code|http \d{3}|\b[45]\d{2} error|json|javascript|snippets?|extraits? de recherche|headless|selector|element number|step limit|hand-?offs?|token limit|context window|retry|retries|réessay)/i;
