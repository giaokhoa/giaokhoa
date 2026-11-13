/**
 * Các lời gọi HTTP gói chương trình cho màn quản trị.
 *
 * API chỉ đọc bản phát hành trong danh mục công khai; hàng chờ, lịch sử
 * bản gửi và lịch sử cài được máy chủ gác bằng quyền của người gọi.
 */
import { apiJson } from "#lib/api";

export interface ProgrammePackageMeta {
  id: string;
  version: string;
  scope: string;
  checksum: string;
  outcomeCount: number;
  status: "pending" | "published" | "rejected";
  centreSlug: string | null;
  createdAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

export interface ProgrammePackageInstall {
  id: string;
  packageVersion: string;
  packageChecksum: string;
  previousVersion: string | null;
  scope: string;
  installedAt: string;
}

export interface ProgrammePackageDetail {
  package: ProgrammePackageMeta;
  curricula: Array<{
    curriculumId: string;
    subjectName: string | null;
    subjectSlug: string;
    grade: number;
  }>;
  nodes: Array<{
    nodeId: string;
    curriculumId: string;
    title: string;
    parentId: string | null;
  }>;
  outcomes: Array<{
    outcomeId: string;
    nodeId: string;
    content: unknown;
    sourceRef: string | null;
  }>;
}

const base = "/api/v1/system-bank/outcome-packages";

/** Danh sách phát hành dùng để chọn bản cài. */
export function fetchPublishedProgrammes() {
  return apiJson<ProgrammePackageMeta[]>(base);
}

/** Danh sách phiên bản mà chính trung tâm đã gửi. */
export function fetchMyProgrammes() {
  return apiJson<ProgrammePackageMeta[]>(`${base}/mine`);
}

/** Lịch sử các bản đã cài trong kho trung tâm hiện tại. */
export function fetchInstalledProgrammes() {
  return apiJson<ProgrammePackageInstall[]>(`${base}/installed`);
}

/** Hàng chờ biên tập viên hệ thống. */
export function fetchPendingProgrammes() {
  return apiJson<ProgrammePackageMeta[]>(`${base}/pending`);
}

/** Tải nội dung bản đang chờ duyệt, không đi qua đường công khai. */
export function fetchProgrammeForReview(version: string) {
  return apiJson<ProgrammePackageDetail>(
    `${base}/review/${encodeURIComponent(version)}`,
  );
}

/** Chụp cây chương trình tại kho riêng và gửi duyệt. */
export function submitProgramme(version: string, scope: string) {
  return apiJson<{ package: ProgrammePackageMeta }>(base, {
    method: "POST",
    body: JSON.stringify({ version, scope, mappings: [] }),
  });
}

/** Duyệt hoặc từ chối bản chờ, lý do bắt buộc khi từ chối. */
export function reviewProgramme(
  version: string,
  approve: boolean,
  reason: string,
) {
  return apiJson<ProgrammePackageMeta>(
    `${base}/${encodeURIComponent(version)}/${approve ? "approve" : "reject"}`,
    {
      method: "POST",
      ...(approve ? {} : { body: JSON.stringify({ reason }) }),
    },
  );
}

/** Cài đúng phiên bản đã duyệt vào kho riêng; server bảo đảm transaction. */
export function installProgramme(version: string) {
  return apiJson<{ install: ProgrammePackageInstall; unchanged: boolean }>(
    `${base}/${encodeURIComponent(version)}/install`,
    { method: "POST" },
  );
}
