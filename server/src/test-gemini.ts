import { GeminiProvider } from "./ai/gemini.provider.js";

const main = async () => {
  const provider = new GeminiProvider();

  const result = await provider.generate(
    "You are a helpful assistant.",
    "Say hello and confirm that Gemini integration works."
  );

  console.log("\nGEMINI RESPONSE\n");
  console.log(result);
};

main().catch((error) => {
  console.error(
    "Gemini test failed:",
    error
  );

  process.exit(1);
});