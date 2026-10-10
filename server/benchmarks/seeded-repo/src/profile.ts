export function createProfile(input: any) {
  return {
    email: input.email,
    age: Number(input.age),
  };
}