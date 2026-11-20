// Who a bot is about to write to. An address that appears nowhere in the user's messages, their files or
// anything read in the chat was made up or mistyped: the card for that action always shows, and says so,
// whatever the approval settings (Auto mode, a trusted connector, "allow for this chat"). In the 2026-11-20
// conversation a bot proposed three addresses that were not in the user's file.
// Pure: tests/unit/recipients-core.test.mts.

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;

/** Every email address anywhere inside an action's input, in lower case, once each. */
export function addressesIn(input: unknown): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") for (const m of v.matchAll(EMAIL)) out.add(m[0].replace(/\.$/, "").toLowerCase());
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(input);
  return [...out];
}

/** The addresses of an input that `seen` doesn't know. `seen` null: there is nothing to check against. */
export function unseenAddresses(input: unknown, seen: ((address: string) => boolean) | null): string[] {
  if (!seen) return [];
  return addressesIn(input).filter((a) => !seen(a));
}
