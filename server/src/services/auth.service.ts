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

const DEFAULT_EXPIRES_IN = "1d";

// Accepts values such as "30m", "12h", "1d" (digits + s/m/h/d). Anything else
// falls back to the default so a typo cannot break every login.
export const resolveTokenExpiry = (
  value: string | undefined = process.env.JWT_EXPIRES_IN,
): NonNullable<jwt.SignOptions["expiresIn"]> => {
  const candidate = value?.trim();
  return (candidate && /^[1-9]\d{0,5}[smhd]$/.test(candidate)
    ? candidate
    : DEFAULT_EXPIRES_IN) as NonNullable<jwt.SignOptions["expiresIn"]>;
};

export const generateToken = (userId: string): string => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET!,
    {
      expiresIn: resolveTokenExpiry(),
    }
  );
};