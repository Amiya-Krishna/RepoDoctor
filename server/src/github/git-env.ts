/**
 * Git credentials are passed through git's environment configuration, never in
 * a URL or argv (both are visible in process listings and logs), and never into
 * Docker containers.
 */
export const gitAuthEnvironment = (token: string): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
  GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
});
