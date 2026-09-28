import { OpenRouterProvider } from "./ai/openrouter.provider.js";

const main = async () => {
  console.log("Testing OpenRouter...\n");

  const provider = new OpenRouterProvider();

  const result = await provider.generate(
    "You are a helpful assistant.",
    "Reply with exactly: OpenRouter is working."
  );

  console.log("OPENROUTER RESPONSE\n");
  console.log(result);
};

main().catch((error) => {
  console.error("OpenRouter test failed:", error);
  process.exit(1);
});