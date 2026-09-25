import { generateAIResponse } from "./services/ai.service";

const testAI = async () => {
  const response = await generateAIResponse(
    "You are a software engineering assistant.",
    "Explain what a JavaScript Promise is in one sentence."
  );

  console.log("\nAI RESPONSE:\n");
  console.log(response);
};

testAI().catch((error) => {
  console.error("AI test failed:", error);
  process.exit(1);
});