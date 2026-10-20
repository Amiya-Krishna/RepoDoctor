/**
 * Reads a positive integer from the environment. Empty, non-numeric or
 * non-positive values (e.g. "7 minutes", "420000ms", "0") fall back to the
 * default instead of producing NaN.
 */
export const envPositiveInt = (name: string, fallback: number): number => {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
