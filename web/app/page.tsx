import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { Slime } from "@/components/Slime";
import { CurvyArrow, LoopLine, MotionTicks, Sparkle, SwooshArrow, Underline } from "@/components/Doodles";
import { DownloadButton } from "@/components/download/DownloadButton";
import {
  BookIcon,
  BotIcon,
  BrainIcon,
  CheckIcon,
  FolderIcon,
  HomeIcon,
  KeyIcon,
  LaptopIcon,
  LockIcon,
} from "@/components/icons";

export default function Home() {
  return (
    <>
      <SiteNav />
      <main>
        <Hero />
        <Agents />
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
        <span className="tag">
          <span className="tag-dot" style={{ background: "#FDDA80" }} /> Meet your new AI team
        </span>
        <h1 className="hero-title">
          You have a team.<br className="br-lg" /> They just happen<br className="br-lg" /> to be{" "}
          <span className="hl">
            AI
            <Underline className="hl-underline" />
          </span>
          .
        </h1>
        <p className="lead">
          Meet oovi. Your own team of AI agents, working together to turn your ideas into reality.
        </p>
        <div className="cta-row">
          <DownloadButton os="mac" size="lg">Download for Mac</DownloadButton>
          <DownloadButton os="windows" variant="light" size="lg">Download for Windows</DownloadButton>
        </div>
        <p className="fine">Free during the pilot · Bring your own AI key</p>
      </div>

      <div className="hero-art" aria-hidden>
        <svg className="orbit orbit-back" viewBox="0 0 600 300">
          <ellipse cx="300" cy="150" rx="285" ry="88" transform="rotate(-14 300 150)" fill="none" stroke="#171717" strokeWidth="2.2" />
        </svg>
        <MotionTicks className="hero-ticks" size={86} />
        <Sparkle className="hero-sparkle" size={44} />
        <Slime color="blue" shape="egg" face="dash" faceAt={[110, 92]} faceTilt={-8} className="hs hs-blue" delay={0.4} />
        <Slime color="yellow" shape="round" face="smile" faceAt={[92, 100]} faceTilt={6} className="hs hs-yellow" delay={1.2} />
        <Slime color="coral" shape="lump" face="happy" faceAt={[104, 108]} faceTilt={-4} className="hs hs-coral" delay={0} />
        <svg className="orbit orbit-front" viewBox="0 0 600 300">
          <path
            d="M15 150 A285 88 0 0 0 585 150"
            transform="rotate(-14 300 150)"
            fill="none"
            stroke="#171717"
            strokeWidth="2.2"
            strokeDasharray="0 330 1000"
          />
        </svg>
        <div className="hero-note">
          <span>Think</span>
          <span>Create</span>
          <span>Execute</span>
          <CurvyArrow className="hero-note-arrow" size={64} />
        </div>
        <div className="ground-shadow" />
      </div>
    </section>
  );
}

const AGENTS = [
  {
    name: "Think",
    color: "blue" as const,
    dot: "#A9BCF7",
    text: "Research, plan, and find the best path.",
    face: "focus" as const,
    extra: "ticks" as const,
    shape: "wide" as const,
  },
  {
    name: "Create",
    color: "yellow" as const,
    dot: "#FDDA80",
    text: "Turn ideas into beautiful plans, drafts and designs.",
    face: "wink" as const,
    extra: "loops" as const,
    shape: "round" as const,
  },
  {
    name: "Execute",
    color: "coral" as const,
    dot: "#FF9F86",
    text: "Handle the details and get things done.",
    face: "cool" as const,
    extra: "curl" as const,
    shape: "lump" as const,
  },
];

function Agents() {
  return (
    <section id="product" className="agents container">
      <div className="agents-copy">
        <LoopLine className="agents-loop" />
        <span className="tag tag-tilt">
          <Sparkle size={14} color="#A9BCF7" /> Three agents. Infinite possibilities.
        </span>
        <h2 className="h2 tilt">
          Three minds.
          <br />
          One mission.
        </h2>
        <p className="agents-sub">
          Think, create, execute, together. <SwooshArrow className="agents-swoosh" size={64} />
        </p>
      </div>
      <div className="agent-cards">
        {AGENTS.map((a, i) => (
          <article key={a.name} className={`agent-card agent-card-${i}`}>
            <Slime color={a.color} shape={a.shape} face={a.face} extra={a.extra} className="agent-slime" delay={i * 0.7} />
            <div className="agent-card-body">
              <h3>
                <span className="dot" style={{ background: a.dot }} />
                {a.name}
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
                <li><FolderIcon /> Projects</li>
                <li><BotIcon /> Agents</li>
                <li><BookIcon /> Library</li>
              </ul>
              <p className="window-hand">Let&apos;s build!</p>
            </aside>
            <div className="window-main">
              <div className="prompt">
                <span>Build a startup from scratch.</span>
                <span className="prompt-go">→</span>
              </div>
              <ul className="tasks">
                <li>
                  <Slime color="blue" shape="egg" face="dash" className="task-slime" />
                  <div>
                    <b>Think</b>
                    <small>Researching the market…</small>
                  </div>
                  <span className="task-status done"><CheckIcon size={16} /></span>
                </li>
                <li>
                  <Slime color="yellow" shape="round" face="dash" className="task-slime" delay={0.6} />
                  <div>
                    <b>Create</b>
                    <small>Building the brand identity…</small>
                  </div>
                  <span className="task-status spin" />
                </li>
                <li>
                  <Slime color="coral" shape="lump" face="dash" className="task-slime" delay={1.1} />
                  <div>
                    <b>Execute</b>
                    <small>Preparing your launch plan…</small>
                  </div>
                  <span className="task-status wait">•••</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="float-card fc-brand">
          <b>Brand Strategy</b>
          <svg viewBox="0 0 120 70" className="fc-img">
            <rect width="120" height="70" rx="8" fill="#E7ECFD" />
            <rect x="72" y="8" width="38" height="30" rx="4" fill="#FDDA80" opacity=".8" />
            <path d="M0 58 L28 30 L52 50 L74 26 L120 62 L120 70 L0 70Z" fill="#A9BCF7" />
            <path d="M0 64 L36 44 L64 60 L96 46 L120 66 L120 70 L0 70Z" fill="#8FA5EC" />
          </svg>
          <i className="fc-line" />
          <i className="fc-line short" />
        </div>
        <div className="float-card fc-launch">
          <b>Launch Plan</b>
          <div className="fc-launch-body">
            <div className="fc-lines">
              <i className="fc-line" />
              <i className="fc-line" />
              <i className="fc-line short" />
            </div>
            <svg viewBox="0 0 48 40" className="fc-bars">
              <rect x="2" y="24" width="8" height="16" rx="2" fill="#FFC3B3" />
              <rect x="14" y="16" width="8" height="24" rx="2" fill="#FF9F86" />
              <rect x="26" y="8" width="8" height="32" rx="2" fill="#F4866B" />
              <rect x="38" y="2" width="8" height="38" rx="2" fill="#E9705A" />
            </svg>
          </div>
        </div>
        <div className="float-card fc-web">
          <b>Website Design</b>
          <svg viewBox="0 0 120 70" className="fc-img">
            <rect width="120" height="70" rx="8" fill="#EEE9F8" />
            <circle cx="92" cy="20" r="8" fill="#171717" />
            <path d="M8 66 L46 26 L70 50 L84 38 L116 66Z" fill="#171717" />
            <path d="M8 66 L46 26 L56 36 L30 66Z" fill="#CDBFEA" />
          </svg>
        </div>
        <MotionTicks className="sc-ticks-a" size={40} />
        <MotionTicks className="sc-ticks-b" size={36} />
      </div>

      <div className="showcase-copy">
        <span className="tag">One request. A whole team.</span>
        <h2 className="h2">
          From idea
          <br />
          to impact.
        </h2>
        <p className="lead small">Just tell oovi what you need, and watch your team get to work.</p>
        <DownloadButton size="md" showIcon={false}>Try it now</DownloadButton>
        <CurvyArrow className="showcase-arrow" size={84} flip />
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "1",
      title: "The leader plans",
      text: "Describe what you want in plain words. Your team leader breaks it into clear steps and decides who does what.",
      color: "blue" as const,
    },
    {
      n: "2",
      title: "Teammates do the work",
      text: "Each slime takes its part: researching, writing, designing, browsing and building, side by side.",
      color: "yellow" as const,
    },
    {
      n: "3",
      title: "You approve",
      text: "You stay in charge. Review results, ask for changes, and approve anything important before it happens.",
      color: "coral" as const,
    },
  ];
  return (
    <section id="how" className="how container">
      <div className="section-head">
        <span className="tag">How it works</span>
        <h2 className="h2">Your ideas, handled by a team.</h2>
        <p className="lead small">No prompts to babysit. Just say what you need and oovi takes it from there.</p>
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
      <div className="features">
        <div className="feature">
          <span className="feature-icon" style={{ background: "#FDDA80" }}><KeyIcon /></span>
          <div>
            <h3>Bring your own key</h3>
            <p>Connect the AI provider you already use with your own API key. You pay the provider directly, with no markup from us.</p>
          </div>
        </div>
        <div className="feature">
          <span className="feature-icon" style={{ background: "#CDBFEA" }}><BrainIcon /></span>
          <div>
            <h3>Skills &amp; memory</h3>
            <p>Teach your team new skills and let them remember what matters, so every project starts smarter than the last.</p>
          </div>
        </div>
        <div className="feature">
          <span className="feature-icon" style={{ background: "#BBD8C4" }}><LaptopIcon /></span>
          <div>
            <h3>Runs on your computer</h3>
            <p>oovi is a desktop app for Mac and Windows. Your team lives on your machine, not in someone else’s cloud.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function About() {
  return (
    <section id="about" className="about container">
      <div className="about-card">
        <span className="tag">About oovi</span>
        <h2 className="h3">A friendlier way to work with AI.</h2>
        <p>
          We built oovi because one chatbot in a box is not a team. oovi gives you a small crew of AI agents with
          their own roles, that plan together, share notes and check in with you. It’s playful on the outside and
          serious about getting your work done.
        </p>
        <p>
          oovi is in its pilot phase: it’s free to use while we learn and improve. Paid plans with extras may come
          later.
        </p>
      </div>
      <div className="about-card data-card">
        <span className="feature-icon" style={{ background: "#fff" }}><LockIcon /></span>
        <h2 className="h3">Your data stays on your device.</h2>
        <p>
          Your bots, chats, memories, skills and API keys are stored locally on your computer, and your keys are
          encrypted. We never see your conversations.
        </p>
        <p>
          Your oovi account is only for signing in: it holds your email, name and profile photo. Optional crash
          reports help us fix bugs and never include your chats.
        </p>
        <Link href="/privacy" className="text-link">Read our Privacy Policy →</Link>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="final">
      <div className="container final-inner">
        <div className="final-copy">
          <span className="tag">
            <span className="tag-dot" style={{ background: "#A9BCF7" }} /> Your ideas deserve a team.
          </span>
          <h2 className="h2">
            Stop working alone.
            <br />
            Meet your <span className="hl-text">oovi</span> team.
          </h2>
          <p className="lead small">A smarter, kinder, more creative way to get things done.</p>
          <DownloadButton size="lg" showIcon={false}>Download for Mac + Windows</DownloadButton>
        </div>
        <div className="final-art" aria-hidden>
          <Sparkle className="final-sparkle" size={46} />
          <LoopLine className="final-loop" size={150} />
          <MotionTicks className="final-ticks" size={70} />
          <Slime color="yellow" shape="round" face="dash" className="fs fs-yellow" delay={0.9} />
          <Slime color="blue" shape="egg" face="dash" faceAt={[96, 96]} faceTilt={6} className="fs fs-blue" delay={0.2} />
          <Slime color="coral" shape="lump" face="dash" faceAt={[110, 96]} faceTilt={-10} className="fs fs-coral" delay={1.5} />
        </div>
      </div>
      <svg className="final-hill" viewBox="0 0 1440 160" preserveAspectRatio="none" aria-hidden>
        <path d="M0 160 L0 120 C320 30 760 10 1100 60 C1250 82 1360 100 1440 92 L1440 160 Z" />
      </svg>
    </section>
  );
}
