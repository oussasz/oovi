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
          <li><Link href="/pricing">Pricing</Link></li>
          <li><Link href="/feedback">Feedback</Link></li>
          <li><Link href="/#about">About</Link></li>
          <li><Link href="/privacy">Privacy</Link></li>
          <li><Link href="/terms">Terms</Link></li>
          <li><Link href="/refund">Refunds</Link></li>
          <li><Link href="/download">Download</Link></li>
          <li><Link href="/changelog">What’s new</Link></li>
        </ul>
      </div>
      <div className="container footer-legal">© {new Date().getFullYear()} oovi. All rights reserved.</div>
    </footer>
  );
}
