import axios from "axios";

export const AUTH_EXPIRED_EVENT = "repodoctor:auth-expired";

// Default "/api" is same-origin: nginx (Docker) and the Vite dev server (local)
// both serve the app on http://localhost:8080 and proxy /api and /socket.io.
export const API_URL: string = import.meta.env.VITE_API_URL ?? "/api";

/** Socket.IO origin: the API URL without its /api suffix ("" = same origin). */
export const socketBaseUrl = (): string => {
  const base = API_URL.replace(/\/api\/?$/, "");
  return base || window.location.origin;
};

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
});

// A 401 on a request that carried a token means the session is no longer
// valid (expired or revoked). Drop the token and tell the app to show the
// login form. Login/register failures (wrong password) are not session expiry.
api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      error.config?.headers?.Authorization &&
      !/\/auth\/(login|register)$/.test(error.config.url ?? "")
    ) {
      localStorage.removeItem("token");
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    return Promise.reject(error);
  },
);

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
