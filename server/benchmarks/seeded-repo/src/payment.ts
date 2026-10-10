export async function processPayment(
  charge: () => Promise<string>,
): Promise<string> {
  charge();
  return "success";
}