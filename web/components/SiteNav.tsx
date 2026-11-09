import Link from "next/link";
import { Logo } from "./Logo";
import { NavAccount } from "./NavAccount";
import { DownloadButton } from "./download/DownloadButton";

export function SiteNav() {
  return (
    <header className="nav-wrap">
      <nav className="nav container" aria-label="Main">
        <Logo />
        <ul className="nav-links">
          <li>
            <Link href="/#product">Product</Link>
          </li>
          <li>
            <Link href="/#how">How it works</Link>
          </li>
          <li>
            <Link href="/pricing">Pricing</Link>
          </li>
          <li>
            <Link href="/#about">About</Link>
          </li>
        </ul>
        <div className="nav-actions">
          <NavAccount />
          <DownloadButton size="sm" className="nav-dl">
            <span className="hide-sm">Download for Mac + Windows</span>
            <span className="show-sm">Download</span>
          </DownloadButton>
        </div>
      </nav>
    </header>
  );
}
