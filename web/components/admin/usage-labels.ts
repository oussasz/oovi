import type { UsageCountKey, UsageTotalKey } from "@/lib/telemetry";

export const USAGE_LABELS: Record<UsageCountKey, { label: string; short: string }> = {
  messages: { label: "Messages sent", short: "Msgs" },
  botReplies: { label: "Bot replies", short: "Replies" },
  toolCalls: { label: "Tool calls", short: "Tools" },
  tokensIn: { label: "Tokens in", short: "Tok in" },
  tokensOut: { label: "Tokens out", short: "Tok out" },
  costUsd: { label: "AI cost", short: "Cost" },
  filesCreated: { label: "Files created", short: "Files" },
  searches: { label: "Web searches", short: "Search" },
  sandboxRuns: { label: "Sandbox runs", short: "Sandbox" },
  webPages: { label: "Web pages read", short: "Pages" },
};

export const TOTAL_LABELS: Record<UsageTotalKey, string> = {
  bots: "Bots",
  groups: "Groups",
  connectors: "Connectors",
  skills: "Skills",
};
