import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});
import { api } from "../lib/api";
import RepairReport from "../pages/RepairReport";

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);

const report = (over: Record<string, unknown> = {}, patchHash = "h".repeat(64)) => ({
  data: {
    repair: { id: "j1", status: "AWAITING_APPROVAL", errorMessage: null, pullRequestUrl: null, branchName: null, pullRequestNumber: null, ...over },
    patch: { title: "Fix add", summary: "s", risk: "LOW", patchHash, changes: [{ filePath: "src/a.js", changeType: "REPLACE", startLine: 2, endLine: 2, originalCode: "a - b", replacementCode: "a + b", explanation: "e" }] },
    verification: { status: "VERIFIED", summary: "ok", confidence: 0.9, evidence: ["e"], testPassed: true, regressionDetected: false },
    testRun: { success: true, exitCode: 0, timedOut: false, durationMs: 1000, testCommand: ["npm", "test"], stdout: "", stderr: "" },
    limitations: ["RepoDoctor never merges pull requests."],
  },
});
const apiError = (status: number, data: Record<string, unknown>) =>
  new AxiosError("x", "ERR", undefined, undefined, { status, data } as AxiosResponse);

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("RepairReport", () => {
  it("approve sends the patch hash that is on screen and nothing else is approved by loading", async () => {
    get.mockResolvedValue(report());
    post.mockResolvedValue({ data: { message: "Approved." } });
    render(<RepairReport repairJobId="j1" onClose={() => undefined} />);
    await screen.findByText("Fix add");
    expect(post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Approve and create pull request/ }));
    expect(post).toHaveBeenCalledWith("/repairs/j1/approve", { patchHash: "h".repeat(64) }, expect.anything());
  });

  it("PATCH_CHANGED: says it was NOT approved, reloads the report and shows the new patch", async () => {
    get.mockResolvedValueOnce(report()).mockResolvedValue(report({}, "n".repeat(64)));
    post.mockRejectedValue(apiError(409, { code: "PATCH_CHANGED", message: "changed" }));
    render(<RepairReport repairJobId="j1" onClose={() => undefined} />);
    await userEvent.click(await screen.findByRole("button", { name: /Approve and create pull request/ }));
    expect(await screen.findByText(/was NOT approved/)).toBeTruthy();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole("button", { name: /Approve and create pull request/ }));
    expect(post).toHaveBeenLastCalledWith("/repairs/j1/approve", { patchHash: "n".repeat(64) }, expect.anything());
  });

  it("an approved job can be withdrawn until a branch is pushed", async () => {
    get.mockResolvedValue(report({ status: "TESTING" }));
    post.mockResolvedValue({ data: {} });
    render(<RepairReport repairJobId="j1" onClose={() => undefined} />);
    await userEvent.click(await screen.findByRole("button", { name: "Withdraw approval" }));
    expect(post).toHaveBeenCalledWith("/repairs/j1/revoke-approval", {}, expect.anything());
    expect(await screen.findByText(/Approval withdrawn. Nothing was pushed./)).toBeTruthy();
  });

  it("once the branch is pushed approval can no longer be withdrawn, and progress is described truthfully", async () => {
    get.mockResolvedValue(report({ status: "BRANCH_PUSHED", branchName: "repodoctor/fix-abc" }));
    render(<RepairReport repairJobId="j1" onClose={() => undefined} />);
    await screen.findByText(/The branch is on GitHub. Creating the pull request/);
    expect(screen.queryByRole("button", { name: "Withdraw approval" })).toBeNull();
    expect(screen.queryByText(/Open pull request on GitHub/)).toBeNull();
  });

  it("blocked publication with an existing branch says so and never claims a PR exists", async () => {
    get.mockResolvedValue(report({ status: "PUBLISH_BLOCKED", branchName: "repodoctor/fix-abc", errorMessage: "Publishing did not complete." }));
    render(<RepairReport repairJobId="j1" onClose={() => undefined} />);
    expect(await screen.findByText(/already exists on GitHub, but no pull request has been created/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Open pull request/ })).toBeNull();
  });

  it("NEEDS_REAPPROVAL and APPROVAL_REVOKED explain that nothing was published", async () => {
    get.mockResolvedValue(report({ status: "NEEDS_REAPPROVAL" }));
    const { unmount } = render(<RepairReport repairJobId="j1" onClose={() => undefined} />);
    expect(await screen.findByText(/nothing was published/)).toBeTruthy();
    unmount();
    get.mockResolvedValue(report({ status: "APPROVAL_REVOKED" }));
    render(<RepairReport repairJobId="j1" onClose={() => undefined} />);
    expect(await screen.findByText(/You withdrew your approval. Nothing was published./)).toBeTruthy();
  });

  it("completed repair links to the PR and states that RepoDoctor never merges", async () => {
    get.mockResolvedValue(report({ status: "COMPLETED", pullRequestUrl: "https://github.test/o/r/pull/7" }));
    render(<RepairReport repairJobId="j1" onClose={() => undefined} />);
    expect((await screen.findByRole("link", { name: /Open pull request/ })).getAttribute("href")).toBe("https://github.test/o/r/pull/7");
    expect(screen.getByText(/never merges: review and merge it on GitHub yourself/)).toBeTruthy();
  });

  it("in-flight statuses poll for updates; terminal ones do not", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    get.mockResolvedValue(report({ status: "REVALIDATING" }));
    render(<RepairReport repairJobId="j1" onClose={() => undefined} />);
    await screen.findByText(/fresh clone/);
    const before = get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(4100);
    expect(get.mock.calls.length).toBeGreaterThan(before);
    cleanup();
    get.mockClear();
    get.mockResolvedValue(report({ status: "COMPLETED", pullRequestUrl: "u" }));
    render(<RepairReport repairJobId="j1" onClose={() => undefined} />);
    await screen.findByText(/COMPLETED/);
    await vi.advanceTimersByTimeAsync(9000);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
