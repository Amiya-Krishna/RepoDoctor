
const ALLOWED_COMMANDS: Record<string, string[]> = {
  npm: [
    "test",
    "run test",
    "run test:unit",
    "run lint",
    "run typecheck",
    "run build",
  ],
  pnpm: [
    "test",
    "run test",
    "run test:unit",
    "run lint",
    "run typecheck",
    "run build",
  ],
  yarn: [
    "test",
    "test:unit",
    "lint",
    "typecheck",
    "build",
  ],
};

export function isAllowedTestCommand(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, " ");

  // Disallow shell chaining, substitutions, redirection and separators.
  if (
    /[;&|`$<>\\\n\r]/.test(normalized) ||
    normalized.includes("$(") ||
    normalized.includes("..")
  ) {
    return false;
  }

  const [packageManager, ...args] = normalized.split(" ");

  if (!packageManager || args.length === 0) return false;

  const allowed = ALLOWED_COMMANDS[packageManager];

  return allowed?.includes(args.join(" ")) ?? false;
}
