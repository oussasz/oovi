// The oovi logo (public/mark.png, and mark-dark.png in dark mode). Use this wherever the brand
// appears; bot faces (Face / FaceStack) are for bots, not for the logo.
export default function Logo({ size = 96, className }: { size?: number; className?: string }) {
  return (
    <picture className={className}>
      <source srcSet="/mark-dark.png" media="(prefers-color-scheme: dark)" />
      <img src="/mark.png" alt="oovi" width={size} height={size} style={{ width: size, height: size, display: "block" }} />
    </picture>
  );
}
