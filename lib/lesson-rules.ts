// What may never be saved as a lesson or in memory. Pure: no imports, so memory, learning and tests share it.

/**
 * Lessons known to be wrong, saved by older versions (and never again, as a lesson or in memory): a slow page taken for a site that's down
 * ("the tunnel is likely down, ask the owner to restart instead of retrying"). They made bots give up
 * on pages that only needed more time, so they're dropped on read.
 */
export const WRONG_LESSON = /(empty|blank|vide)[^.]*(tunnel|offline|down|hors ligne|coup[ée])|tunnel[^.]*(is |est )?(likely |probablement )?(down|offline|coup[ée]|hors ligne)/i;
