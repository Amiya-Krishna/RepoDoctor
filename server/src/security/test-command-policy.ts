/**
 * Test-command policy for the repair sandbox.
 *
 * The command comes from an API request and is executed (inside the sandbox)
 * against repository code, so it is allow-listed strictly rather than
 * block-listed. Arbitrary interpreters (`node -e`, `npx <package>`, `sh -c`)
 * are refused: they would let a request run any code.
 */

const SAFE_SCRIPT_NAMES = new Set(["test", "test:unit", "lint", "typecheck", "build"]);

// Characters that never appear in a legitimate argument of the allowed forms.
const FORBIDDEN_ARG = /[;&|`$<>\\\n\r\0(){}*?!~]|\.\./;

const SAFE_RELATIVE_FILE = /^(?!\/)(?!-)[A-Za-z0-9_./@-]{1,200}\.(?:js|mjs|cjs|ts)$/;

export type CommandVerdict = { ok: true; argv: string[] } | { ok: false; reason: string };

export function validateTestCommand(value: unknown): CommandVerdict {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) {
    return { ok: false, reason: "The test command must be a short argument array." };
  }
  if (!value.every((p) => typeof p === "string" && p.length > 0 && p.length <= 200)) {
    return { ok: false, reason: "Every command argument must be a non-empty string of at most 200 characters." };
  }
  const argv = value as string[];
  if (argv.some((a) => FORBIDDEN_ARG.test(a))) {
    return { ok: false, reason: "The test command contains characters that are not allowed." };
  }

  const [tool, ...args] = argv;

  if (tool === "npm" || tool === "pnpm") {
    if (args.length === 1 && (args[0] === "test" || args[0] === "t")) return { ok: true, argv };
    if (args.length === 2 && args[0] === "run" && SAFE_SCRIPT_NAMES.has(args[1])) return { ok: true, argv };
    if (args.length === 1 && SAFE_SCRIPT_NAMES.has(args[0]) && tool === "pnpm") return { ok: true, argv };
    return { ok: false, reason: `Allowed: ${tool} test, or ${tool} run <${[...SAFE_SCRIPT_NAMES].join("|")}>.` };
  }

  if (tool === "yarn") {
    if (args.length === 1 && SAFE_SCRIPT_NAMES.has(args[0])) return { ok: true, argv };
    return { ok: false, reason: `Allowed: yarn <${[...SAFE_SCRIPT_NAMES].join("|")}>.` };
  }

  if (tool === "node") {
    // Only syntax-check or run one repository file; never -e/-p/--eval/--require/--import.
    if (args.length === 2 && args[0] === "--check" && SAFE_RELATIVE_FILE.test(args[1])) return { ok: true, argv };
    if (args.length === 2 && args[0] === "--test" && SAFE_RELATIVE_FILE.test(args[1])) return { ok: true, argv };
    if (args.length === 1 && SAFE_RELATIVE_FILE.test(args[0])) return { ok: true, argv };
    return { ok: false, reason: "Allowed: node <file>, node --check <file>, node --test <file> (relative path, no -e/-p/--require)." };
  }

  return { ok: false, reason: "Only npm, pnpm, yarn and node test commands are allowed (npx and shells are not)." };
}

/** Legacy string form kept for existing callers/tests. */
export function isAllowedTestCommand(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized) return false;
  return validateTestCommand(normalized.split(" ")).ok;
}
