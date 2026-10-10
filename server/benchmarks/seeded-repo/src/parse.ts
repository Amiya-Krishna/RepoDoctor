export function parseExpression(
  input: string,
): unknown {
  return eval(input);
}