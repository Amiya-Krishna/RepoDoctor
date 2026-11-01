import "dotenv/config";

export const aiConfig = {
  openrouterKey:
  process.env.OPENROUTER_API_KEY ?? "",
  
  openrouterModel:
  process.env.OPENROUTER_MODEL ||
  "openrouter/free",
  
  groqApiKey:
  process.env.GROQ_API_KEY ?? "",
  
  groqModel:
  process.env.GROQ_MODEL ||
  "openai/gpt-oss-20b",
  
  geminiApiKey:
  process.env.GEMINI_API_KEY ?? "",
  
  geminiModel:
  process.env.GEMINI_MODEL ||
  "gemini-2.5-flash",
};

const hasPlaceholder = (value: string) => value.trim() === "" || value.trim() === "...";

export const isProviderConfigured = {
  openrouter: () => !hasPlaceholder(aiConfig.openrouterKey),
  groq: () => !hasPlaceholder(aiConfig.groqApiKey),
  gemini: () => !hasPlaceholder(aiConfig.geminiApiKey),
};

export const isAnyCloudProviderConfigured = () =>
  isProviderConfigured.openrouter() || isProviderConfigured.groq() || isProviderConfigured.gemini();

export const isLocalProviderConfigured = () =>
  /^https?:\/\//i.test(process.env.LOCAL_AI_BASE_URL ?? "") && Boolean(process.env.LOCAL_AI_MODEL);

// Importing this module no longer throws when no provider is configured:
// the API must be able to start (and tell the user what to configure).
// Egress is refused per request by the privacy policy instead (fail closed).
