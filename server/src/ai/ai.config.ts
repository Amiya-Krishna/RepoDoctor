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

if (
  !isProviderConfigured.openrouter() &&
  !isProviderConfigured.groq() &&
  !isProviderConfigured.gemini()
) {
  throw new Error(
    "No AI provider is configured. Set at least one of OPENROUTER_API_KEY, GROQ_API_KEY or GEMINI_API_KEY."
  );
}
