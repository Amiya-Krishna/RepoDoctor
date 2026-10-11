import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:5000/api",
  withCredentials: true,
});

/** Best-effort human-readable message from an Axios or generic error. */
export const getErrorMessage = (error: unknown, fallback: string): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: unknown } | undefined;
    if (typeof data?.message === "string" && data.message) return data.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};
