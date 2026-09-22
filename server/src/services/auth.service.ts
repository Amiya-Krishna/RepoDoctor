import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export const hashPassword = async (
  password: string
): Promise<string> => {
  return bcrypt.hash(password, 10);
};

export const comparePassword = async (
  password: string,
  hashedPassword: string
): Promise<boolean> => {
  return bcrypt.compare(password, hashedPassword);
};

export const generateToken = (userId: string): string => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET!,
    {
      expiresIn: "1d",
    }
  );
};