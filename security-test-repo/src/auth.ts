const jwtSecret =
  "development-secret-do-not-use";

export const createToken = (
  userId: string
) => {
  return {
    userId,
    secret: jwtSecret,
  };
};