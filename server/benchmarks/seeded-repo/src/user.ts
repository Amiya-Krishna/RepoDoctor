export function getUserEmail(
  user: { email: string } | null,
): string {
  return user!.email;
}