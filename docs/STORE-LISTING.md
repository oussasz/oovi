# Microsoft Store listing for oovi

Store ID: 9NKGRTVXWGZC · https://apps.microsoft.com/detail/9NKGRTVXWGZC
Package identity: Conuron.oovi (publisher Conuron), set in package.json > build.appx.

## Submitting a version

1. Each GitHub release builds `oovi-Store-<version>.appx` (Windows job). Download it
   from the release on oussasz/oovi (it is not copied to the public downloads repo).
2. Partner Center > oovi > Start your submission > Packages: drag in the .appx.
   The Store signs it when it's published; no certificate is needed.
3. Restricted capability: the package asks for `runFullTrust` (every desktop app
   in the Store does). If asked why, paste:
   "oovi is a desktop (Electron) app. It needs full trust to run its local
   server, use the browser the user picks for web tasks, and read and write
   files in folders the user chooses."
4. Submit. Review usually takes a few days.

## First submission: settings

- Pricing: Free. Markets: all.
- Category: Productivity. Subcategory: none.
- Privacy policy URL: https://oovi.vercel.app/privacy
- Website: https://oovi.vercel.app
- Support contact: your email.
- Age ratings: answer the questionnaire. oovi has user-generated text and talks
  to AI services on the user's own key; no violence, no purchases.

## Store listing: English (en-US)

**Product name:** oovi

**Short description (≤ 100 characters):**
Your own team of AI agents that research, write and build, on your own API keys.

**Description:**
oovi gives you a team of friendly AI bots that work together on real tasks. Give
each bot a face and a job, put them in groups, and watch them hand work to each
other until you get one clear answer.

What your team can do
• Research the web for real: search several sources, read full pages and cite them.
• Make real files: Word documents, Excel spreadsheets with formulas, PowerPoint
  slides, PDF and CSV.
• Work in your project folders and write code, with your approval for every change.
• Use a private cloud computer to run code, analyze data and build web apps.
• Connect to the tools you already use (Google, Microsoft 365, Notion, Slack,
  GitHub and 60+ more) by signing in through your browser.
• Learn from you: bots remember your preferences and the lessons from past work.
• Think harder when it matters: pick the effort level, or turn on Deep work for
  big tasks.
• Answer you on Telegram while you're away from your computer.

Your keys, your data
oovi runs on your own API keys from Anthropic (Claude), OpenAI, Google Gemini,
OpenRouter and others. No subscription. Your chats and files stay on your
computer.

**What's new in this version:** leave blank for the first submission.

**Product features** (one per line in Partner Center):
- A team of AI bots that plan, hand work to each other and give you one answer
- Real web research with sources: several searches, full pages read
- Creates Word, Excel, PowerPoint, PDF and CSV files
- Deep work mode and an effort level for every message
- Bots learn your preferences and lessons from past work
- Private cloud computer to run code and analyze data
- Works in your project folders, with your approval for every change
- 60+ connectors: Google, Microsoft 365, Notion, Slack, GitHub and more
- Uses your own API keys: Claude, OpenAI, Gemini, OpenRouter and more
- No subscription; your chats and files stay on your computer
- Reach your main bot on Telegram when you're away
- English, French, Arabic, Spanish, German and Turkish

**Short description** (Supplemental fields, ≤ 270 characters):
A team of AI bots that research, write and build for you. They plan together,
read the web with sources, create Word and Excel files and learn your
preferences, all on your own API keys with no subscription.

**Keywords (up to 7):** AI agents, AI assistant, Claude, ChatGPT, research,
automation, productivity

**Copyright and trademark info:** © 2026 Conuron. All rights reserved.

**Developed by:** Conuron

**Images** (all in docs/store/):
- Screenshots (upload in this order): 1-team-plan.png, 2-report-learned.png,
  5-effort.png, 4-marketplace.png, 3-home.png (1920×1080, from the real app with
  an example team).
- 9:16 Poster art: poster-720x1080.png
- 1:1 Box art: box-1080x1080.png
- 1:1 App tile icon (300×300): tile-300x300.png
- Leave trailers and Xbox images empty.

## Store listing: Français (fr-FR)

**Nom du produit :** oovi

**Description courte (≤ 100 caractères) :**
Votre équipe d'agents IA qui cherchent, écrivent et créent, avec vos propres clés API.

**Description :**
oovi vous donne une équipe de bots IA sympathiques qui travaillent ensemble sur de
vraies tâches. Donnez à chaque bot un visage et un rôle, réunissez-les en groupes
et regardez-les se passer le travail jusqu'à vous donner une réponse claire.

Ce que votre équipe sait faire
• Faire de vraies recherches sur le web : plusieurs sources, pages lues en entier,
  sources citées.
• Créer de vrais fichiers : Word, Excel avec formules, PowerPoint, PDF et CSV.
• Travailler dans vos dossiers de projet et écrire du code, avec votre accord
  pour chaque modification.
• Utiliser un ordinateur cloud privé pour exécuter du code, analyser des données
  et créer des applis web.
• Se connecter à vos outils (Google, Microsoft 365, Notion, Slack, GitHub et plus
  de 60 autres) en vous connectant depuis votre navigateur.
• Apprendre de vous : les bots retiennent vos préférences et les leçons du travail
  passé.
• Réfléchir davantage quand c'est important : choisissez le niveau d'effort ou
  activez le Travail approfondi.
• Vous répondre sur Telegram quand vous n'êtes pas devant votre ordinateur.

Vos clés, vos données
oovi fonctionne avec vos propres clés API d'Anthropic (Claude), OpenAI, Google
Gemini, OpenRouter et d'autres. Sans abonnement. Vos discussions et vos fichiers
restent sur votre ordinateur.

**Fonctionnalités :**
- Une équipe de bots IA qui planifient, se passent le travail et vous donnent une seule réponse
- De vraies recherches sur le web, avec les sources
- Crée des fichiers Word, Excel, PowerPoint, PDF et CSV
- Mode Travail approfondi et niveau d'effort pour chaque message
- Les bots retiennent vos préférences et les leçons du travail passé
- Ordinateur cloud privé pour exécuter du code et analyser des données
- Travaille dans vos dossiers de projet, avec votre accord pour chaque modification
- Plus de 60 connecteurs : Google, Microsoft 365, Notion, Slack, GitHub…
- Fonctionne avec vos propres clés API : Claude, OpenAI, Gemini, OpenRouter…
- Sans abonnement ; vos discussions et fichiers restent sur votre ordinateur

**Description courte :**
Une équipe de bots IA qui cherchent, écrivent et créent pour vous. Ils
planifient ensemble, lisent le web avec les sources, créent des fichiers Word
et Excel et retiennent vos préférences, avec vos propres clés API, sans
abonnement.

**Mots-clés :** agents IA, assistant IA, Claude, ChatGPT, recherche,
automatisation, productivité
