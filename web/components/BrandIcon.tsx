import { BRAND_ICONS } from "@/lib/brand-icons";

/** A small real logo (or a plain drawn icon) for a place people heard about oovi. Decorative: the label next to it says the name. */
export function BrandIcon({ name, size = 20 }: { name?: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true, focusable: false } as const;
  if (name === "microsoft") {
    return (
      <svg {...common}>
        <rect x="2" y="2" width="9.5" height="9.5" fill="#F25022" />
        <rect x="12.5" y="2" width="9.5" height="9.5" fill="#7FBA00" />
        <rect x="2" y="12.5" width="9.5" height="9.5" fill="#00A4EF" />
        <rect x="12.5" y="12.5" width="9.5" height="9.5" fill="#FFB900" />
      </svg>
    );
  }
  if (name === "friend") {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="8" r="3.2" />
        <path d="M2.8 19.5c.4-3.3 3-5.2 6.2-5.2s5.8 1.9 6.2 5.2" />
        <path d="M15.6 5.2a3 3 0 0 1 0 5.6M18.2 14.6c1.8.7 3 2.2 3.3 4.3" />
      </svg>
    );
  }
  const brand = name ? BRAND_ICONS[name] : undefined;
  if (brand) {
    return (
      <svg {...common} fill={brand.color}>
        <path d={brand.path} />
      </svg>
    );
  }
  return (
    <svg {...common} fill="currentColor">
      <circle cx="5.5" cy="12" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="18.5" cy="12" r="1.9" />
    </svg>
  );
}
