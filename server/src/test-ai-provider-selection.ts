import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// ai.config.ts reads the environment when it is first imported, so each
// scenario runs in a fresh Node process with exactly the keys it names.
// No network calls are made: providers only build SDK clients.
const execFileAsync = promisify(execFile);

const run = async (env: Record<string, string>, code: string) => {
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", code],
      {
        env: {
          PATH: process.env.PATH ?? "",
          DOTENV_CONFIG_PATH: "/nonexistent/.env", // never read a developer's .env
          DOTENV_CONFIG_QUIET: "true",
          ...env,
        },
        cwd: process.cwd(),
        timeout: 60_000,
      },
    );
    return { ok: true as const, out: stdout.trim() };
  } catch (error) {
    const failure = error as { stderr?: string; message: string };
    return { ok: false as const, out: `${failure.stderr ?? ""}${failure.message}` };
  }
};

const listProviders = `
  const { createAIProvider } = await import("./src/ai/ai.provider.factory.js");
  const manager = createAIProvider();
  console.log(JSON.stringify(manager.providers.map((p) => p.constructor.name)));
`;

// One key is enough (the previous code required all three).
let result = await run({ GROQ_API_KEY: "test-groq-key" }, listProviders);
assert.ok(result.ok, result.out);
assert.deepEqual(JSON.parse(result.out), ["GroqProvider"]);

// All keys: fixed fallback order OpenRouter -> Groq -> Gemini.
result = await run(
  { OPENROUTER_API_KEY: "a", GROQ_API_KEY: "b", GEMINI_API_KEY: "c" },
  listProviders,
);
assert.ok(result.ok, result.out);
assert.deepEqual(JSON.parse(result.out), [
  "OpenRouterProvider",
  "GroqProvider",
  "GeminiProvider",
]);

// Placeholder "..." values from older templates do not count as configured.
result = await run({ GROQ_API_KEY: "...", GEMINI_API_KEY: "real-gemini-key" }, listProviders);
assert.ok(result.ok, result.out);
assert.deepEqual(JSON.parse(result.out), ["GeminiProvider"]);

// No usable key: a clear configuration error.
result = await run({}, listProviders);
assert.equal(result.ok, false);
assert.match(result.out, /No AI provider is configured/);
result = await run({ OPENROUTER_API_KEY: "...", GROQ_API_KEY: "  " }, listProviders);
assert.equal(result.ok, false);
assert.match(result.out, /No AI provider is configured/);

// Empty *_MODEL values (as in .env.example) fall back to the defaults.
result = await run(
  { GROQ_API_KEY: "k", OPENROUTER_MODEL: "", GROQ_MODEL: "", GEMINI_MODEL: "" },
  `const { aiConfig } = await import("./src/ai/ai.config.js");
   console.log(JSON.stringify([aiConfig.openrouterModel, aiConfig.groqModel, aiConfig.geminiModel]));`,
);
assert.ok(result.ok, result.out);
assert.deepEqual(JSON.parse(result.out), [
  "openrouter/free",
  "openai/gpt-oss-20b",
  "gemini-2.5-flash",
]);

console.log("AI provider selection tests passed.");
