import Image from "next/image";
import Link from "next/link";

export function Logo({ size = 44, href = "/" }: { size?: number; href?: string | null }) {
  const inner = (
    <>
      <span className="logo-mark" style={{ width: size, height: size }}>
        <Image src="/mark.png" alt="" width={size} height={size} className="logo-light" priority />
        <Image src="/mark-dark.png" alt="" width={size} height={size} className="logo-dark" />
      </span>
      <span className="wordmark" style={{ fontSize: size * 0.72 }}>
        oovi
      </span>
    </>
  );
  if (href === null) return <span className="logo">{inner}</span>;
  return (
    <Link href={href} className="logo" aria-label="oovi home">
      {inner}
    </Link>
  );
}
