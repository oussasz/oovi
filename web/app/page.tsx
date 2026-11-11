import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { Slime } from "@/components/Slime";
import { Underline } from "@/components/Doodles";
import { DownloadButton } from "@/components/download/DownloadButton";
import { BookIcon, BotIcon, CheckIcon, FolderIcon, HomeIcon } from "@/components/icons";

export default function Home() {
  return (
    <>
      <SiteNav />
      <main>
        <Hero />
        <Team />
        <Showcase />
        <HowItWorks />
        <About />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}

function Hero() {
  return (
    <section className="hero container">
      <div className="hero-copy">
        <h1 className="hero-title">
          You have a team.<br className="br-lg" /> They just happen<br className="br-lg" /> to be{" "}
          <span className="hl">
            AI
            <Underline className="hl-underline" />
          </span>
          .
        </h1>
        <p className="lead">
          oovi is a desktop app where a few AI bots work on your request together. A leader plans, the others research,
          write and check, and you approve anything that touches the outside world.
        </p>
        <div className="cta-row">
          <DownloadButton os="windows" size="lg">Download for Windows</DownloadButton>
          <DownloadButton os="mac" variant="light" size="lg">Download for Mac</DownloadButton>
        </div>
        <p className="fine">Free during the pilot. Uses your own AI provider key.</p>
        <p className="fine soon-line">
          <span className="pill-soon">Coming soon</span> oovi on your phone and on the web.
        </p>
      </div>

      <div className="hero-art" aria-hidden>
        <svg className="orbit orbit-back" viewBox="0 0 600 300">
          <ellipse cx="300" cy="150" rx="285" ry="88" transform="rotate(-14 300 150)" fill="none" stroke="currentColor" strokeWidth="2.2" />
        </svg>
        <Slime color="blue" shape="egg" face="dash" faceAt={[110, 92]} faceTilt={-8} className="hs hs-blue" delay={0.4} />
        <Slime color="yellow" shape="round" face="smile" faceAt={[92, 100]} faceTilt={6} className="hs hs-yellow" delay={1.2} />
        <Slime color="coral" shape="lump" face="happy" faceAt={[104, 108]} faceTilt={-4} className="hs hs-coral" delay={0} />
        <svg className="orbit orbit-front" viewBox="0 0 600 300">
          <path
            d="M15 150 A285 88 0 0 0 585 150"
            transform="rotate(-14 300 150)"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeDasharray="0 330 1000"
          />
        </svg>
        <div className="ground-shadow" />
      </div>
    </section>
  );
}

const TEAM = [
  {
    name: "Scout",
    role: "Researcher",
    color: "blue" as const,
    dot: "#A9BCF7",
    text: "Searches the web, opens the pages that matter and brings back sources.",
    face: "focus" as const,
    extra: "ticks" as const,
    shape: "wide" as const,
  },
  {
    name: "Quill",
    role: "Writer",
    color: "yellow" as const,
    dot: "#FDDA80",
    text: "Turns notes into drafts, emails and posts, in the tone you ask for.",
    face: "wink" as const,
    extra: "loops" as const,
    shape: "round" as const,
  },
  {
    name: "Nova",
    role: "Critic",
    color: "coral" as const,
    dot: "#FF9F86",
    text: "Reads the result, catches mistakes and says what to fix.",
    face: "cool" as const,
    extra: "curl" as const,
    shape: "lump" as const,
  },
];

function Team() {
  return (
    <section id="product" className="agents container">
      <div className="agents-copy">
        <h2 className="h2">
          A leader and
          <br />
          as many bots as you need.
        </h2>
        <p className="agents-sub">
          Oovi, your leader, decides who does what and gives you one final answer. You start with these three; add as
          many bots as you like, each with its own job, look and AI model.
        </p>
      </div>
      <div className="agent-cards">
        {TEAM.map((a, i) => (
          <article key={a.name} className={`agent-card agent-card-${i}`}>
            <Slime color={a.color} shape={a.shape} face={a.face} extra={a.extra} className="agent-slime" delay={i * 0.7} />
            <div className="agent-card-body">
              <h3>
                <span className="dot" style={{ background: a.dot }} />
                {a.name} <span className="agent-role">{a.role}</span>
              </h3>
              <p>{a.text}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Showcase() {
  return (
    <section className="showcase container">
      <div className="showcase-art" aria-hidden>
        <div className="window">
          <div className="window-bar">
            <i style={{ background: "#FF8A7A" }} />
            <i style={{ background: "#FDCB52" }} />
            <i style={{ background: "#7BCF8E" }} />
          </div>
          <div className="window-body">
            <aside className="window-side">
              <img src="/mark.png" alt="" width={46} height={46} className="window-mark" />
              <ul>
                <li className="on"><HomeIcon /> Home</li>
                <li><FolderIcon /> Groups</li>
                <li><BotIcon /> Bots</li>
                <li><BookIcon /> Library</li>
              </ul>
            </aside>
            <div className="window-main">
              <div className="prompt">
                <span>Compare three note-taking apps and draft a short review.</span>
                <span className="prompt-go">→</span>
              </div>
              <ul className="tasks">
                <li>
                  <Slime color="blue" shape="egg" face="dash" className="task-slime" />
                  <div>
                    <b>Scout</b>
                    <small>Read 6 sources</small>
                  </div>
                  <span className="task-status done"><CheckIcon size={16} /></span>
                </li>
                <li>
                  <Slime color="yellow" shape="round" face="dash" className="task-slime" delay={0.6} />
                  <div>
                    <b>Quill</b>
                    <small>Writing the draft</small>
                  </div>
                  <span className="task-status spin" />
                </li>
                <li>
                  <Slime color="coral" shape="lump" face="dash" className="task-slime" delay={1.1} />
                  <div>
                    <b>Nova</b>
                    <small>Waiting for the draft</small>
                  </div>
                  <span className="task-status wait">•••</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="float-card fc-brand">
          <b>Sources</b>
          <svg viewBox="0 0 120 70" className="fc-img">
            <rect width="120" height="70" rx="8" fill="#E7ECFD" />
            <rect x="10" y="12" width="70" height="7" rx="3.5" fill="#A9BCF7" />
            <rect x="10" y="28" width="92" height="7" rx="3.5" fill="#A9BCF7" opacity=".7" />
            <rect x="10" y="44" width="56" height="7" rx="3.5" fill="#A9BCF7" opacity=".5" />
          </svg>
        </div>
        <div className="float-card fc-launch">
          <b>Draft</b>
          <div className="fc-launch-body">
            <div className="fc-lines">
              <i className="fc-line" />
              <i className="fc-line" />
              <i className="fc-line short" />
            </div>
          </div>
        </div>
        <div className="float-card fc-web">
          <b>Review notes</b>
          <div className="fc-lines">
            <i className="fc-line" />
            <i className="fc-line short" />
          </div>
        </div>
      </div>

      <div className="showcase-copy">
        <h2 className="h2">
          See every step
          <br />
          as it happens.
        </h2>
        <p className="lead small">
          Each bot shows what it&apos;s doing: the search it ran, the page it opened, the draft it wrote. Open any bot&apos;s
          screen and zoom in.
        </p>
        <DownloadButton size="md" showIcon={false}>Download oovi</DownloadButton>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "1",
      title: "You ask once",
      text: "Write what you need in plain words. The leader splits it into tasks and picks who does each one.",
      color: "blue" as const,
    },
    {
      n: "2",
      title: "The team works",
      text: "Each bot takes the part that fits its job, for example research, writing or review. They hand work to each other without you managing it.",
      color: "yellow" as const,
    },
    {
      n: "3",
      title: "You approve",
      text: "Before a bot clicks, types or posts anything on a website, it shows you the exact action and waits for your yes.",
      color: "coral" as const,
    },
  ];
  const details = [
    {
      title: "Your own AI key",
      text: "Claude, GPT, Gemini, Grok, OpenRouter, or a model running on your computer. You pay the provider directly; oovi adds nothing on top.",
    },
    { title: "Memory", text: "Bots keep short notes about you and your work, so you explain things once." },
    {
      title: "Skills",
      text: "When you ask for the same kind of task again, a bot can save the steps as a skill and reuse them next time.",
    },
    { title: "On your computer", text: "Chats, memory and keys stay on your device. Keys are encrypted." },
  ];
  return (
    <section id="how" className="how container">
      <div className="section-head">
        <h2 className="h2">How a request is handled</h2>
      </div>
      <ol className="how-steps">
        {steps.map((s, i) => (
          <li key={s.n} className="how-step">
            <div className="how-step-top">
              <span className="how-n">{s.n}</span>
              <Slime color={s.color} shape={i === 0 ? "egg" : i === 1 ? "round" : "lump"} face={i === 2 ? "happy" : "dash"} className="how-slime" delay={i * 0.5} />
            </div>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </li>
        ))}
      </ol>
      <dl className="details">
        {details.map((d) => (
          <div key={d.title} className="detail">
            <dt>{d.title}</dt>
            <dd>{d.text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function About() {
  return (
    <section id="about" className="about about-single container">
      <div className="about-card">
        <h2 className="h3">Why we built oovi</h2>
        <p>
          One chat window is fine for a quick answer. Real work needs someone to plan, someone to dig, someone to write
          and someone to check. oovi gives each of those jobs to a bot and lets them work together, while you keep the
          final say.
        </p>
        <p>
          oovi is in a free pilot while we improve it. Your oovi account only holds your email, name and photo; your
          chats never leave your computer. <Link href="/privacy" className="text-link">Privacy Policy</Link>
        </p>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="final-simple container">
      <h2 className="h2">Set up your team in a few minutes.</h2>
      <p className="lead small">Free during the pilot. Windows and Mac. Phone and web versions are coming soon.</p>
      <DownloadButton size="lg" showIcon={false}>Download for Windows + Mac</DownloadButton>
    </section>
  );
}
