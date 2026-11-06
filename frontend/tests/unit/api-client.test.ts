import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../src/lib/api-client";

afterEach(() => vi.unstubAllGlobals());

const session = (token: string) =>
  Response.json({ authenticated: true, csrf: { headerName: "X-CSRF-TOKEN", token } });

describe("browser API client", () => {
  it("chỉ fetch same-origin, không cache và không tự gửi token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await apiRequest<{ items: unknown[] }>("/api/me/workspaces")).toMatchObject({
      kind: "data",
      status: 200,
      data: { items: [] },
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/me/workspaces", expect.objectContaining({
      cache: "no-store",
      credentials: "same-origin",
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers.has("Authorization")).toBe(false);
  });

  it("bootstrap CSRF cho POST, gắn idempotency và giữ 202 ở trạng thái pending", async () => {
    const operation = { operationId: "op-1", state: "PENDING", completed: false, statusUrl: "/api/me/operations/op-1" };
    const fetchMock = vi.fn().mockResolvedValueOnce(session("csrf-one"))
      .mockResolvedValueOnce(Response.json(operation, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await apiRequest("/api/workspaces/abc/classes", {
      method: "POST", body: JSON.stringify({ name: "Lớp 1" }),
    });
    expect(result).toEqual({ kind: "pending", status: 202, data: operation });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/session");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store", credentials: "same-origin" });
    const options = fetchMock.mock.calls[1][1] as RequestInit;
    const headers = new Headers(options.headers);
    expect(headers.get("X-CSRF-TOKEN")).toBe("csrf-one");
    expect(headers.get("Idempotency-Key")).toBeTruthy();
    expect(options.cache).toBe("no-store");
    expect(options.credentials).toBe("same-origin");
  });

  it("giữ trạng thái 202 khi response chứa operation lồng trong StudentIssueView", async () => {
    const studentIssue = {
      operation: { id: "op-2", state: "APPLYING", completed: false, targetType: "STUDENT" },
      handoff: { username: "student", temporaryPassword: "only-on-create" },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(studentIssue, { status: 202 })));
    expect(await apiRequest("/api/issued-student")).toEqual({
      kind: "pending", status: 202, data: studentIssue,
    });
  });

  it("đọc CSRF mới ở từng mutation, không giữ cache phiên", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(session("old"))
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(session("new"))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await apiRequest("/api/logout", { method: "POST" });
    await apiRequest("/api/logout", { method: "POST" });
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get("X-CSRF-TOKEN")).toBe("old");
    expect(new Headers(fetchMock.mock.calls[3][1].headers).get("X-CSRF-TOKEN")).toBe("new");
    expect(fetchMock.mock.calls.filter(([path]) => path === "/api/session")).toHaveLength(2);
  });

  it.each([403, 409, 428, 503])("xử lý problem+json %i theo mã lỗi", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(
      { status, code: "API_PROBLEM", detail: "Thông báo an toàn", traceId: "trace-1" },
      { status, headers: { "Content-Type": "application/problem+json" } },
    )));
    await expect(apiRequest("/api/secure")).rejects.toMatchObject({
      status, code: "API_PROBLEM", traceId: "trace-1",
    });
  });

  it("thất bại an toàn khi thiếu CSRF, không gửi mutation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ authenticated: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiRequest("/api/classes", { method: "POST" })).rejects.toThrow(/CSRF/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("không nhận 202 báo hoàn tất hoặc statusUrl khác origin", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({
      operationId: "x", state: "SUCCEEDED", completed: true, statusUrl: "/api/me/operations/x",
    }, { status: 202 })).mockResolvedValueOnce(Response.json({
      operationId: "x", state: "PENDING", completed: false, statusUrl: "https://external.example/steal",
    }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiRequest("/api/thing")).rejects.toThrow(/202/);
    await expect(apiRequest("/api/thing")).rejects.toThrow(/202/);
  });

  it("từ chối URL ngoài /api, escape path và Authorization", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const path of ["https://other.example/api/me", "//other.example/api", "/api/../private", "/api/%2e%2e/private"]) {
      await expect(apiRequest(path)).rejects.toThrow();
    }
    await expect(apiRequest("/api/me", { headers: { Authorization: "Bearer secret" } })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("giữ idempotency do caller cấp và trả dữ liệu rỗng cho 204", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(session("csrf"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await apiRequest("/api/thing", {
      method: "DELETE", headers: { "Idempotency-Key": "stable-key", "If-Match": "\"7\"" },
    })).toEqual({ kind: "data", status: 204, data: undefined });
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get("Idempotency-Key")).toBe("stable-key");
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get("If-Match")).toBe("\"7\"");
  });
});
