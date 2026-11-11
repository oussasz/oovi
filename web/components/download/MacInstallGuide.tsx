/* eslint-disable @next/next/no-img-element */
// How to open oovi on a Mac the first time, in 3 short steps with pictures.
// oovi for Mac isn't notarized by Apple yet, so macOS (15 Sequoia and later) blocks the first open;
// "right-click > Open" no longer works there. Apple's own way: System Settings > Privacy & Security >
// Open Anyway (https://support.apple.com/guide/mac-help/mh40616/mac).
// The pictures are drawings of what macOS shows (Apple's wording), not screenshots: Apple's and other
// sites' screenshots aren't free to reuse.

const APPLE_GUIDE = "https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac";

function Window({ title, titleLeft, children }: { title?: string; titleLeft?: boolean; children: React.ReactNode }) {
  return (
    <div className="mac-win" aria-hidden="true">
      <div className="mac-bar">
        <span className="mac-dot r" />
        <span className="mac-dot y" />
        <span className="mac-dot g" />
        {title && <span className={titleLeft ? "mac-title left" : "mac-title"}>{title}</span>}
      </div>
      <div className="mac-body">{children}</div>
    </div>
  );
}

function FolderIcon() {
  return (
    <svg width="54" height="44" viewBox="0 0 54 44" aria-hidden="true">
      <path d="M3 8a4 4 0 0 1 4-4h13l5 5h22a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" fill="#5aa9f0" />
      <path d="M3 14h48v23a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" fill="#7cc0f7" />
      <path d="M19 22h16l-3 10H22z" fill="#fff" opacity=".85" />
    </svg>
  );
}

export function MacInstallGuide() {
  return (
    <div className="mac-guide">
      <p className="mac-guide-lead">
        oovi isn’t checked by Apple yet, so the first time, your Mac asks you to confirm. It takes a minute, once.
      </p>
      <ol className="mac-steps">
        <li>
          <Window title="oovi">
            <div className="mac-dmg">
              <span className="mac-app">
                <img src="/mark.png" alt="" width={44} height={44} />
                <small>oovi</small>
              </span>
              <span className="mac-arrow">→</span>
              <span className="mac-app">
                <FolderIcon />
                <small>Applications</small>
              </span>
            </div>
          </Window>
          <p>
            <b>1.</b> Open the downloaded file and drag <b>oovi</b> into <b>Applications</b>.
          </p>
        </li>
        <li>
          <Window>
            <div className="mac-alert">
              <img src="/mark.png" alt="" width={30} height={30} />
              <b>“oovi” Not Opened</b>
              <small>Apple could not verify “oovi” is free of malware that may harm your Mac or compromise your privacy.</small>
              <span className="mac-btn primary ring">Done</span>
              <span className="mac-btn">Move to Trash</span>
            </div>
          </Window>
          <p>
            <b>2.</b> Open <b>oovi</b> from Applications. Your Mac says it can’t check it: click <b>Done</b>.
          </p>
        </li>
        <li>
          <Window title="Privacy & Security" titleLeft>
            <div className="mac-settings">
              <div className="mac-side">
                <span>Battery</span>
                <span>Lock Screen</span>
                <span className="on">Privacy & Security</span>
              </div>
              <div className="mac-pane">
                <b>Security</b>
                <small>“oovi” was blocked to protect your Mac.</small>
                <span className="mac-btn ring">Open Anyway</span>
              </div>
            </div>
          </Window>
          <p>
            <b>3.</b> Open <b>System Settings → Privacy & Security</b>, scroll down, click <b>Open Anyway</b> and enter
            your Mac password. oovi opens, and from now on it opens normally.
          </p>
        </li>
      </ol>
      <p className="alt">
        Pictures show what macOS displays; your screen may look a little different. Apple explains the same steps{" "}
        <a href={APPLE_GUIDE} target="_blank" rel="noreferrer">
          here
        </a>
        . Only download oovi from this website.
      </p>
    </div>
  );
}
