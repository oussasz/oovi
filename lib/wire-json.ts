// Kept apart from llm.ts so it can be tested on its own.

/**
 * The request body as JSON a strict parser accepts. Text cut in the middle of an emoji (a shortened
 * tool result, a clipped page) leaves half a character; JSON.stringify writes it as "\ud83d", and the
 * model service refuses the whole request ("not valid JSON: unexpected end of hex escape").
 * Every string is made whole here, at the one place requests leave the app.
 */
export const wireJson = (body: unknown): string => JSON.stringify(body, (_k, v: unknown) => (typeof v === "string" && !v.isWellFormed() ? v.toWellFormed() : v));
