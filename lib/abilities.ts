// What a bot can and can't do on the web, said from its REAL settings (never from defaults), with
// the user's other bots that can do what it can't, and the exact steps to turn an ability on.
// Without this, bots guessed: a writer said it "can only read public pages", and a bot with a
// browser refused to post on Facebook instead of explaining "Use my signed-in accounts".
// Pure (no imports from the rest of oovi): the labels come from the caller, in the user's language.

export type Abilities = { web: boolean; browser: boolean; accounts: boolean };
type Named = { id: string; name: string; tools: { web: boolean; browser: boolean; accounts?: boolean } };

/** The words the user sees in the app (already translated), so the steps match the screen. */
export type AbilityLabels = {
  abilities: string; // the "Abilities" section of a bot's settings
  web: string; // "Web search"
  browser: string; // "Browser"
  accounts: string; // "Use my signed-in accounts"
  accountsPlace: string; // "Settings → Your accounts"
};

/** "Use my signed-in accounts" only works with the browser on (the settings enforce it too). */
export const abilitiesOf = (b: Named): Abilities => ({ web: !!b.tools.web, browser: !!b.tools.browser, accounts: !!b.tools.browser && !!b.tools.accounts });

/** "web search, a browser, signed in to the user's accounts" or "no web access". */
export function abilityWords(a: Abilities): string {
  const parts = [a.web ? "web search" : "", a.browser ? "a browser" : "", a.accounts ? "signed in to the user's accounts" : ""].filter(Boolean);
  return parts.length ? parts.join(", ") : "no web access";
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const quoted = (xs: string[]) => list(xs.map((x) => `"${x}"`));

type Where = { kind: "direct" | "group"; isMain: boolean; groupsWith?: (botId: string) => string[] };

export function abilityLines(self: Named, bots: Named[], where: Where, L: AbilityLabels): string[] {
  const me = abilitiesOf(self);
  const others = bots.filter((b) => b.id !== self.id).map((b) => ({ b, a: abilitiesOf(b) }));
  const out: string[] = [];

  // 1. The facts, one per ability.
  const cant = [
    !me.web && !me.browser ? "search or read the web" : "",
    !me.browser ? "open websites, click, type or sign in" : "",
    !me.accounts ? "post, comment, reply or send messages as the user on their accounts" : "",
  ].filter(Boolean);
  out.push(
    `Your abilities, from your settings right now: ${abilityWords(me)}.${cant.map((c) => ` You can't ${c}.`).join("")} Never claim an ability you don't have, and never tell the user oovi can't do something when another bot or a setting can.`,
  );

  // 2. How to turn an ability on, for this bot or for another one (exact places in the app).
  const settingsOf = (name: string, own: boolean) =>
    own && where.kind === "direct" ? `open your settings (the pencil at the top of this chat)` : `open ${name}'s settings (${name} in the bots list, then the pencil at the top of its chat)`;
  const turnOn = (name: string, own: boolean, what: string[]) => `${settingsOf(name, own)} and, under "${L.abilities}", turn on ${quoted(what)}`;
  /** Who else can do it now, and how the user reaches them from here. */
  const routeTo = (names: string[]) => {
    if (!names.length) return "";
    if (where.kind === "group") return ` In this group, @mention ${list(names)} with the task: they can do it now.`;
    if (where.isMain && where.groupsWith) {
      const via = names.flatMap((n) => {
        const id = others.find((o) => o.b.name === n)!.b.id;
        return where.groupsWith!(id).map((g) => `${n} is in "${g}"`);
      });
      if (via.length) return ` ${list(names)} can do it now: ${list(via)}, so you can give that group the job with message_group.`;
    }
    return ` ${list(names)} can do it now: the user can ask them directly.`;
  };

  // 3. Acting as the user on their accounts (posting on Facebook and the like).
  if (!me.accounts) {
    const ready = others.filter((o) => o.a.accounts).map((o) => o.b.name);
    const oneStep = others.filter((o) => o.a.browser && !o.a.accounts).map((o) => o.b.name);
    const mine = turnOn(self.name, true, me.browser ? [L.accounts] : [L.browser, L.accounts]);
    const shorter = !me.browser && oneStep.length ? ` (${list(oneStep)} already ${oneStep.length > 1 ? "have" : "has"} the browser, so for ${oneStep.length > 1 ? "them" : oneStep[0]} only "${L.accounts}" is needed)` : "";
    out.push(
      `To post, comment or send messages on a site as the user (Facebook, Instagram, LinkedIn, X, email…), a bot needs "${L.accounts}", and the user signs in to that site once under "${L.accountsPlace}" (they type their password there themselves; bots never see it; then every click and keystroke asks their OK). If the user asks you for that, don't just refuse. In one or two short sentences: they can ${mine}${shorter}, then sign in under "${L.accountsPlace}".${routeTo(ready)} Meanwhile, prepare what you can, such as the post text or an image.`,
    );
  }

  // 4. Opening websites, and reading the web.
  if (!me.browser) {
    out.push(`If a task needs a website opened (a form, a dashboard, a page that only works in a browser): the user can ${turnOn(self.name, true, [L.browser])} to let you do it.${routeTo(others.filter((o) => o.a.browser).map((o) => o.b.name))}`);
  }
  if (!me.web && !me.browser) {
    out.push(`If you need fresh facts from the web: the user can ${turnOn(self.name, true, [L.web])} to let you search.${routeTo(others.filter((o) => o.a.web || o.a.browser).map((o) => o.b.name))}`);
  }

  // 5. How to work with what it has.
  if (me.accounts) {
    out.push(
      `When the user asks you to do something on a site with their account, start right away: open the site. If it isn't signed in, ask the user to sign in under "${L.accountsPlace}" (or call request_user_takeover so they sign in in your browser), and at the same time ask for anything missing, such as the exact post text. Show the exact text before you post.`,
    );
  } else if (me.browser) {
    out.push(`Your browser is a fresh, private one: the user's accounts aren't signed in there, and a sign-in there is forgotten when the task ends. Use request_user_takeover only to get past a sign-in for this one task.`);
  }
  return out;
}
