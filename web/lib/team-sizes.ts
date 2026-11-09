// Team sizes on the pilot form (safe to import from client components).
export const TEAM_SIZES = [
  { value: "1", label: "Just me" },
  { value: "2-10", label: "2 to 10 people" },
  { value: "11-50", label: "11 to 50 people" },
  { value: "51-200", label: "51 to 200 people" },
  { value: "200+", label: "More than 200 people" },
] as const;

export const teamSizeLabel = (v: string | null) => TEAM_SIZES.find((t) => t.value === v)?.label ?? (v || "–");
