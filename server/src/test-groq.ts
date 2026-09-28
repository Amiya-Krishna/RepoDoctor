import { GroqProvider } from "./ai/groq.provider.js";

const main = async () => {
  const provider = new GroqProvider();

  const result = await provider.generate(
    "You are a helpful assistant.",
    "Say hello and mention that RepoDoctor Groq integration works."
  );

  console.log("\nGROQ RESPONSE\n");
  console.log(result);
};

main().catch((error) => {
  console.error("Groq test failed:", error);
  process.exit(1);
});