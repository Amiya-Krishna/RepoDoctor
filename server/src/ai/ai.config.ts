import "dotenv/config";

export const aiConfig = {
  apiKey: process.env.OPENROUTER_API_KEY,
  model: process.env.OPENROUTER_MODEL || "openrouter/free",
};

if (!aiConfig.apiKey) {
  throw new Error("OPENROUTER_API_KEY is not configured");
}