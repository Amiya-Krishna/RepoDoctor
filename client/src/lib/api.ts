import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:5000/api",
  withCredentials: true,
});

/** Best-effort human-readable message from an Axios or generic error. */
export const getErrorMessage = (error: unknown, fallback: string): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: unknown; error?: unknown } | undefined;
    if (typeof data?.message === "string" && data.message) return data.message;
    // Rate-limit responses use { error } instead of { message }.
    if (typeof data?.error === "string" && data.error) return data.error;
    if (!error.response) {
      return "Cannot reach the server. Make sure the API is running on the configured VITE_API_URL.";
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};