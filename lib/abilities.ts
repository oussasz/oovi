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

type Where = {
  kind: "direct" | "group";
  isMain: boolean;
  groupsWith?: (botId: string) => string[];
  /** request_abilities is offered: the bot shows a one-click card instead of explaining menus. */
  canRequest?: boolean;
  /** Desktop control is offered to this bot: it can work in the user's own apps and browser, with their OK. */
  desktop?: boolean;
};

export function abilityLines(self: Named, bots: Named[], where: Where, L: AbilityLabels): string[] {
  const me = abilitiesOf(self);
  const others = bots.filter((b) => b.id !== self.id).map((b) => ({ b, a: abilitiesOf(b) }));
  const out: string[] = [];

  // 1. The facts, one per ability.
  const cant = [
    !me.web && !me.browser ? "search or read the web" : "",
    !me.browser ? `open websites, click, type or sign in${where.desktop ? " with a browser of your own" : ""}` : "",
    !me.accounts ? `post, comment, reply or send messages as the user on their accounts${where.desktop ? " with a browser of your own" : ""}` : "",
  ].filter(Boolean);
  out.push(
    `Your abilities, from your settings right now: ${abilityWords(me)}.${cant.map((c) => ` You can't ${c}.`).join("")} Never claim an ability you don't have, and never tell the user oovi can't do something when another bot or a setting can.`,
  );
  // Desktop control reaches what a bot's own browser can't: the user's own apps and their own browser,
  // where they are already signed in. A bot that has it does such a job itself.
  if (where.desktop) {
    out.push(
      `You also have desktop control: with the user's OK you see their screen and use their mouse and keyboard, in their own apps and their own browser (where they are signed in). That way you can do for them what your own browser can't: open a site in their browser, send a message, post, fill in a form. When the user asks you to use their computer, one of their apps or their browser, do it yourself that way: don't pass it to another bot or a group, don't ask for another ability first, and never say you can't.`,
    );
  }

  // 2. How to turn an ability on, for this bot or for another one (exact places in the app).
  const settingsOf = (name: string, own: boolean) =>
    own && where.kind === "direct" ? `open your settings (the pencil at the top of this chat)` : `open ${name}'s settings (${name} in the bots list, then the pencil at the top of its chat)`;
  const viaMenus = (name: string, own: boolean, what: string[]) => `${settingsOf(name, own)} and, under "${L.abilities}", turn on ${quoted(what)}`;
  /** One complete instruction: offer the one-click card when available, else explain the menus. */
  const fix = (name: string, own: boolean, what: string[]) =>
    where.canRequest && (own || where.isMain)
      ? `call request_abilities for ${quoted(what)}${own ? "" : ` with bot "${name}"`}: the user turns it on with one click on a card (if they'd rather do it themselves, they can ${viaMenus(name, own, what)})`
      : `tell them they can ${viaMenus(name, own, what)}`;
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
  // With desktop control the bot needs nothing more: the user's own browser is signed in already.
  // (Found by putting "go to facebook.com in my browser and send a message" to the model: it asked
  // for "Use my signed-in accounts" because this paragraph said a bot "needs" it.)
  if (!me.accounts && where.desktop) {
    out.push(
      `To post, comment or send messages on a site as the user (Facebook, Instagram, LinkedIn, X, email…), or to open a page that needs their account: do it in their own browser with desktop control. Open the page with open_in_user_browser, then use the screen, mouse and keyboard. They are already signed in there, so there is nothing to set up and no ability to ask for. "${L.accounts}" (a separate browser of yours, signed in under "${L.accountsPlace}") is only for when the user wants such jobs done without their own screen being used: offer it only if they ask for that.`,
    );
  } else if (!me.accounts) {
    const ready = others.filter((o) => o.a.accounts).map((o) => o.b.name);
    const oneStep = others.filter((o) => o.a.browser && !o.a.accounts).map((o) => o.b.name);
    const mine = fix(self.name, true, me.browser ? [L.accounts] : [L.browser, L.accounts]);
    const shorter = !me.browser && oneStep.length ? ` (${list(oneStep)} already ${oneStep.length > 1 ? "have" : "has"} the browser, so for ${oneStep.length > 1 ? "them" : oneStep[0]} only "${L.accounts}" is needed)` : "";
    out.push(
      `To post, comment or send messages on a site as the user (Facebook, Instagram, LinkedIn, X, email…), a bot needs "${L.accounts}", and the user signs in to that site once under "${L.accountsPlace}" (they type their password there themselves; bots never see it; then every click and keystroke asks their OK). If the user asks you for that, don't just refuse: ${mine}${shorter}. Then they sign in once under "${L.accountsPlace}".${routeTo(ready)} Meanwhile, prepare what you can, such as the post text or an image. Keep it to one or two short sentences.`,
    );
  }

  // 4. Opening websites, and reading the web.
  if (!me.browser && where.desktop) {
    out.push(`If a task needs a website opened (a form, a dashboard, a page that only works in a browser): open it in the user's own browser with open_in_user_browser and work there with desktop control.`);
  } else if (!me.browser) {
    out.push(`If a task needs a website opened (a form, a dashboard, a page that only works in a browser): ${fix(self.name, true, [L.browser])}.${routeTo(others.filter((o) => o.a.browser).map((o) => o.b.name))}`);
  }
  if (!me.web && !me.browser) {
    out.push(`If you need fresh facts from the web: ${fix(self.name, true, [L.web])}.${routeTo(others.filter((o) => o.a.web || o.a.browser).map((o) => o.b.name))}`);
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

// ---------- the Chief's view of the team ----------

type Described = Named & { role?: string; instructions?: string; hidden?: boolean };

/** How much of each bot's description the Chief sees (links and facts are usually near the start). */
export const DIRECTORY_DESC = 400;
export const DIRECTORY_MAX = 40;

/**
 * Descriptions sometimes hold a key or a password. The Chief may run on another provider than that bot,
 * so common secret formats are hidden in the directory (the bot itself still has its full description).
 */
export function hideSecrets(text: string): string {
  return text
    .replace(/\b(sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|pdl_(?:live|sdbx)_[A-Za-z0-9_]{10,}|\d{8,10}:[A-Za-z0-9_-]{30,})\b/g, "[hidden key]")
    .replace(/\b(password|passwd|mot de passe|كلمة السر|كلمة المرور|token|api[ _-]?key|secret)(\s*[:=]\s*)\S+/gi, "$1$2[hidden]");
}

/**
 * Every bot of the user, for the Chief: role, abilities, groups and description. A link or fact that
 * lives in one bot's description (e.g. a dashboard address) is then visible to the Chief, which can use it
 * or give the job to that bot's group instead of asking the user.
 */
export function botDirectory(bots: Described[], selfId: string, groupsWith: (botId: string) => string[]): string[] {
  const shown = bots.slice(0, DIRECTORY_MAX);
  const lines = shown.map((b) => {
    const desc = hideSecrets((b.instructions ?? "").replace(/\s+/g, " ").trim());
    const cut = desc.length > DIRECTORY_DESC ? `${desc.slice(0, DIRECTORY_DESC)}…` : desc;
    const groups = groupsWith(b.id);
    return `- ${b.name}${b.id === selfId ? " (you)" : ""}${b.role ? `, ${b.role}` : ""}${b.hidden ? " (hidden from the bots list)" : ""}. Abilities: ${abilityWords(abilitiesOf(b))}. Groups: ${groups.length ? groups.map((g) => `"${g}"`).join(", ") : "none"}.${cut ? ` Description: ${cut}` : ""}`;
  });
  if (bots.length > shown.length) lines.push(`- …and ${bots.length - shown.length} more (list_groups shows who is in each group).`);
  return [
    "The user's bots (their descriptions may hold links, accounts or facts you need: use them before asking the user):",
    ...lines,
    "When another bot has what a task needs (a link in its description, an ability you lack), use that information yourself, or give the job to a group it's in with message_group. If it's in no group, propose a team with it (propose_team).",
  ];
}
