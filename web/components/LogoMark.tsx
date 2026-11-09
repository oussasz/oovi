import Image from "next/image";
import type { CSSProperties } from "react";

/**
 * The oovi logo mark without the wordmark: public/mark.png, or mark-dark.png in dark mode.
 * Use it wherever the brand is shown. Slime characters are for bots, not for the logo.
 */
export function LogoMark({ size, className, style, priority }: { size: number | string; className?: string; style?: CSSProperties; priority?: boolean }) {
  return (
    <span className={`logo-mark${className ? ` ${className}` : ""}`} style={{ width: size, aspectRatio: "1", ...style }} aria-hidden>
      <Image src="/mark.png" alt="" width={256} height={256} className="logo-light" priority={priority} />
      <Image src="/mark-dark.png" alt="" width={256} height={256} className="logo-dark" />
    </span>
  );
}
