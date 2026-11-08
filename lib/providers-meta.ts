// Shared between server and client: no Node imports here.

export type ProviderId = "anthropic" | "openai" | "xai" | "gemini" | "openrouter" | "groq" | "deepseek" | "mistral" | "ollama" | "custom";

export type ProviderMeta = {
  label: string;
  /** Wire format: Anthropic Messages API or OpenAI-compatible chat completions. */
  kind: "anthropic" | "openai";
  baseUrl: string;
  /** Suggested default; model names change often, so users can override it in Settings. */
  model: string;
  needsKey: boolean;
  keyUrl?: string;
  note?: string;
  /** Has a free tier you can use without paying. */
  free?: boolean;
};

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  anthropic: { label: "Anthropic (Claude)", kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5-5", needsKey: true, keyUrl: "https://console.anthropic.com/settings/keys" },
  openai: { label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-5", needsKey: true, keyUrl: "https://platform.openai.com/api-keys" },
  xai: { label: "xAI (Grok)", kind: "openai", baseUrl: "https://api.x.ai/v1", model: "grok-4", needsKey: true, keyUrl: "https://console.x.ai" },
  gemini: { label: "Google Gemini (free tier)", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash", needsKey: true, keyUrl: "https://aistudio.google.com/apikey", free: true, note: "Free tier with per-minute and daily limits. Get a key in Google AI Studio." },
  openrouter: { label: "OpenRouter (many models, some free)", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/auto", needsKey: true, keyUrl: "https://openrouter.ai/keys", free: true, note: "Models ending in :free cost nothing (with daily limits). A free account is enough." },
  groq: { label: "Groq (fast, free tier)", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", needsKey: true, keyUrl: "https://console.groq.com/keys", free: true, note: "Very fast open models. Free tier with rate limits." },
  deepseek: { label: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", needsKey: true, keyUrl: "https://platform.deepseek.com/api_keys" },
  mistral: { label: "Mistral", kind: "openai", baseUrl: "https://api.mistral.ai/v1", model: "mistral-large-latest", needsKey: true, keyUrl: "https://console.mistral.ai/api-keys" },
  ollama: { label: "Ollama (local, free)", kind: "openai", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3", needsKey: false, free: true, note: "Runs models on your own computer. Pick a model that supports tool calling." },
  custom: { label: "Custom (OpenAI-compatible)", kind: "openai", baseUrl: "", model: "", needsKey: false, note: "Any server that speaks the OpenAI chat-completions format: LM Studio, vLLM, Together, Cerebras…" },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export const providerName = (p: ProviderId) => PROVIDERS[p].label.replace(/ \(.*\)$/, "");
