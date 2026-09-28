import "dotenv/config";

export const aiConfig = {
  openrouterKey:
  process.env.OPENROUTER_API_KEY ?? "",
  
  openrouterModel:
  process.env.OPENROUTER_MODEL ??
  "openrouter/free",
  
  groqApiKey:
  process.env.GROQ_API_KEY ?? "",
  
  groqModel:
  process.env.GROQ_MODEL ??
  "openai/gpt-oss-20b",
  
  geminiApiKey:
  process.env.GEMINI_API_KEY ?? "",
  
  geminiModel:
  process.env.GEMINI_MODEL ??
  "gemini-2.5-flash",
};

if (!aiConfig.openrouterKey) {
  throw new Error(
    "OPENROUTER_API_KEY is not configured"
  );
}