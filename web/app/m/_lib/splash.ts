// iPhone launch screens for the app added to the Home Screen (web/public/m/splash/, made by
// scripts/mobile-icons.cjs): one picture per screen size, light and dark. iOS picks the one whose media matches.
export const SPLASH_SIZES: { w: number; h: number; dpr: number }[] = [
  { w: 375, h: 667, dpr: 2 }, // SE 2nd/3rd gen, 8
  { w: 414, h: 736, dpr: 3 }, // 8 Plus
  { w: 375, h: 812, dpr: 3 }, // X, XS, 11 Pro, 12 mini, 13 mini
  { w: 414, h: 896, dpr: 2 }, // XR, 11
  { w: 414, h: 896, dpr: 3 }, // XS Max, 11 Pro Max
  { w: 390, h: 844, dpr: 3 }, // 12, 13, 14
  { w: 428, h: 926, dpr: 3 }, // 12/13 Pro Max, 14 Plus
  { w: 393, h: 852, dpr: 3 }, // 14 Pro, 15, 15 Pro, 16
  { w: 430, h: 932, dpr: 3 }, // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  { w: 402, h: 874, dpr: 3 }, // 16 Pro
  { w: 440, h: 956, dpr: 3 }, // 16 Pro Max
];

export const splashFile = (s: { w: number; h: number; dpr: number }, dark: boolean) => `/m/splash/${s.w * s.dpr}x${s.h * s.dpr}${dark ? "-dark" : ""}.png`;

export function splashLinks(): { url: string; media: string }[] {
  return SPLASH_SIZES.flatMap((s) =>
    [false, true].map((dark) => ({
      url: splashFile(s, dark),
      media: `(device-width: ${s.w}px) and (device-height: ${s.h}px) and (-webkit-device-pixel-ratio: ${s.dpr}) and (orientation: portrait) and (prefers-color-scheme: ${dark ? "dark" : "light"})`,
    })),
  );
}
