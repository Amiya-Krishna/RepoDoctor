import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});
import { api } from "../lib/api";
import PrivacySettings from "../pages/PrivacySettings";
import AuditHistory from "../components/AuditHistory";

const get = vi.mocked(api.get), put = vi.mocked(api.put);
const disclosure = { version: 2, sent: ["a"], notSent: ["b"], destinations: { CLOUD: "c", LOCAL: "l" }, storedOnServer: ["s"], controls: ["x"] };
const settings = (dataMode: string, consentedAt: string | null) => ({ data: { settings: { dataMode, consentedAt, retentionDays: 30, notifyOnCritical: true }, disclosure, availability: { cloud: true, local: true } } });
afterEach(cleanup);

describe("PrivacySettings", () => {
  it("shows the server's error code and recovery text when a save is refused, and keeps the old settings", async () => {
    get.mockResolvedValue(settings("NONE", null));
    put.mockRejectedValue(new AxiosError("x", "E", undefined, undefined, { status: 400, data: { message: "Consent is out of date.", code: "CONSENT_OUTDATED", recovery: "Review the updated disclosure and consent again." } } as AxiosResponse));
    render(<PrivacySettings onChanged={() => undefined} />);
    await userEvent.click(await screen.findByLabelText(/Cloud AI/));
    await userEvent.click(screen.getByLabelText(/I have read the above/));
    await userEvent.click(screen.getByRole("button", { name: "Save privacy settings" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Consent is out of date\. Review the updated disclosure and consent again\. \(CONSENT_OUTDATED\)/);
  });

  it("turning an enabled mode off needs one explicit confirmation before it is sent", async () => {
    get.mockResolvedValue(settings("CLOUD", "2026-10-01"));
    put.mockResolvedValue({ data: { settings: { dataMode: "NONE", consentedAt: null, retentionDays: 30, notifyOnCritical: true } } });
    const onChanged = vi.fn();
    render(<PrivacySettings onChanged={onChanged} />);
    await userEvent.click(await screen.findByLabelText(/^Off/));
    await userEvent.click(screen.getByRole("button", { name: "Save privacy settings" }));
    expect(put).not.toHaveBeenCalled();
    expect(await screen.findByText(/withdraws your consent/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Confirm: turn AI off/ }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(onChanged).toHaveBeenCalledWith("NONE");
    expect(await screen.findByText(/requests already in progress are stopped/)).toBeTruthy();
  });

  it("cancelling the withdrawal sends nothing", async () => {
    get.mockResolvedValue(settings("LOCAL", "2026-10-01"));
    render(<PrivacySettings onChanged={() => undefined} />);
    await userEvent.click(await screen.findByLabelText(/^Off/));
    await userEvent.click(screen.getByRole("button", { name: "Save privacy settings" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(put).not.toHaveBeenCalled();
  });
});

describe("AuditHistory", () => {
  const ev = (id: string) => ({ id, eventType: "PR_APPROVED", outcome: "SUCCESS", repositoryId: null, repairJobId: null, createdAt: "2026-10-01T10:00:00Z", details: null });
  it("loads page by page with a cursor and appends", async () => {
    get.mockResolvedValueOnce({ data: { events: [ev("e1"), ev("e2")], nextCursor: "e2" } }).mockResolvedValueOnce({ data: { events: [ev("e3")], nextCursor: null } });
    render(<AuditHistory />);
    await screen.findAllByText("pr approved");
    expect(screen.getAllByRole("row")).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(4));
    expect(get).toHaveBeenLastCalledWith("/privacy/audit", expect.objectContaining({ params: { limit: 20, cursor: "e2" } }));
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
  it("shows an error with a retry, and an empty state", async () => {
    get.mockRejectedValueOnce(new Error("boom"));
    render(<AuditHistory />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/boom/);
    cleanup();
    get.mockResolvedValueOnce({ data: { events: [], nextCursor: null } });
    render(<AuditHistory />);
    expect(await screen.findByText("No events yet.")).toBeTruthy();
  });
});
