// The cloud runner switch (runner/ starts the app's server with OOVI_CLOUD_RUNNER=1 for one job at a time).
// Off on every desktop: nothing here changes the app there.
import { isLatinDarija, localeOfText } from "./text-locale";
import { pickLocale, type ReplyLocale } from "./cloud-runner-core";

export const cloudRunner = () => process.env.OOVI_CLOUD_RUNNER === "1";

type Hook = (chatId: string, tool: string) => void;
const g = globalThis as typeof globalThis & { __ooviCloudNeeds?: Set<Hook> };
const hooks = (g.__ooviCloudNeeds ??= new Set<Hook>());

/** A step of this chat needed the user's computer (lib/orchestrator.ts): the job ends as needs_computer. */
export function noteNeedsComputer(chatId: string, tool: string): void {
  for (const h of hooks) {
    try {
      h(chatId, tool);
    } catch {
      /* a listener must not break the run */
    }
  }
}

export function onNeedsComputer(fn: Hook): () => void {
  hooks.add(fn);
  return () => {
    hooks.delete(fn);
  };
}

export const replyLocaleOf = (text: string | undefined | null): ReplyLocale => pickLocale(localeOfText(text), isLatinDarija(text));
