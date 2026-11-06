import { afterEach, describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import { serverApi } from "../../src/lib/server-api";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("Server Components API", () => {
  it("chỉ forward cookie của request hiện tại đến Spring, không cache", async () => {
    vi.stubEnv("BACKEND_INTERNAL_URL", "http://app:8080");
    const incoming = vi.mocked(headers);
    incoming.mockResolvedValueOnce({ get: (key: string) => key === "cookie" ? "SESSION=alice" : "Bearer forbidden" } as never)
      .mockResolvedValueOnce({ get: (key: string) => key === "cookie" ? "SESSION=bob" : null } as never);
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ allowed: true }));
    vi.stubGlobal("fetch", fetchMock);

    await serverApi("/api/me/workspaces");
    await serverApi("/api/me/workspaces");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("http://app:8080/api/me/workspaces");
    expect(fetchMock.mock.calls[1][0]).toBe("http://app:8080/api/me/workspaces");
    const first = fetchMock.mock.calls[0][1];
    const second = fetchMock.mock.calls[1][1];
    expect(new Headers(first.headers).get("cookie")).toBe("SESSION=alice");
    expect(new Headers(second.headers).get("cookie")).toBe("SESSION=bob");
    expect(new Headers(first.headers).get("authorization")).toBeNull();
    expect(first).toMatchObject({ method: "GET", cache: "no-store", redirect: "manual" });
  });

  it("không gửi cookie khi request không có phiên", async () => {
    vi.stubEnv("BACKEND_INTERNAL_URL", "http://app:8080");
    vi.mocked(headers).mockResolvedValue({ get: () => null } as never);
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ authenticated: false }));
    vi.stubGlobal("fetch", fetchMock);
    await serverApi("/api/session");
    expect(new Headers(fetchMock.mock.calls[0][1].headers).has("cookie")).toBe(false);
  });

  it("không forward cookie sang host hoặc path không hợp lệ", async () => {
    vi.stubEnv("BACKEND_INTERNAL_URL", "http://app:8080");
    vi.mocked(headers).mockResolvedValue({ get: () => "SESSION=private" } as never);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(serverApi("https://evil.example/api/me")).rejects.toThrow();
    await expect(serverApi("/api/../login")).rejects.toThrow();
    vi.stubEnv("BACKEND_INTERNAL_URL", "https://user:password@app:8080");
    await expect(serverApi("/api/me")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
