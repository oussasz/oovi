import Link from "next/link";
import { Logo } from "./Logo";

export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <Logo size={40} />
        <ul className="footer-links">
          <li><Link href="/#product">Product</Link></li>
          <li><Link href="/#how">How it works</Link></li>
          <li><Link href="/#about">About</Link></li>
          <li><Link href="/privacy">Privacy</Link></li>
          <li><Link href="/terms">Terms</Link></li>
          <li><Link href="/download">Download</Link></li>
        </ul>
        <p className="footer-note">
          Made for curious minds.
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M9 7v4M15 7v4M7.5 15c2.5 2.6 6.5 2.6 9 0" />
          </svg>
        </p>
      </div>
      <div className="container footer-legal">© {new Date().getFullYear()} oovi. All rights reserved.</div>
    </footer>
  );
}
