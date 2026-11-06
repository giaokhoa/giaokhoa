import { headers } from "next/headers";
import { apiPath, readApiResponse, type ApiResult } from "./api-client";

// Chỉ GET trên server; caller không truyền dữ liệu phiên/CSRF vào SSR payload.
export async function serverApi<T>(path: string): Promise<ApiResult<T>> {
  const urlPath = apiPath(path);
  const base = process.env.BACKEND_INTERNAL_URL;
  if (!base) throw new Error("Thiếu BACKEND_INTERNAL_URL.");
  const backend = new URL(base);
  if (!["http:", "https:"].includes(backend.protocol)
      || backend.username || backend.password
      || backend.pathname !== "/" || backend.search || backend.hash) {
    throw new Error("BACKEND_INTERNAL_URL không hợp lệ.");
  }

  const cookie = (await headers()).get("cookie");
  const requestHeaders = new Headers({ Accept: "application/json" });
  if (cookie) requestHeaders.set("Cookie", cookie);

  const response = await fetch(backend.origin + urlPath, {
    method: "GET",
    headers: requestHeaders,
    cache: "no-store",
    redirect: "manual",
  });
  return readApiResponse<T>(response);
}
