import { createAIProvider } from "./ai/ai.provider.factory.js";

const testAI = async () => {
  const provider = createAIProvider();

  const result = await provider.generate(
    "You are a helpful assistant.",
    "Reply with exactly: RepoDoctor AI is working."
  );

  console.log("\nAI RESPONSE\n");
  console.log(result);
};

testAI().catch((error) => {
  console.error("AI test failed:", error);
  process.exit(1);
});