/**
 * Test theo vai của panel gói chương trình (#17): quản trị trung tâm
 * gửi và cài phiên bản đã duyệt; biên tập viên xem YCCĐ, từ chối có
 * lý do. Các phản hồi API được giả lập, bảo vệ hợp đồng giao diện
 * và đường gọi backend mà không tạo dữ liệu ngoài test.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProgrammePackagePanel } from "./programme-package-panel";
import "#config/i18n";
import { ApiError } from "#lib/api";

const mocks = vi.hoisted(() => ({
  role: "centre" as "centre" | "reviewer" | "viewer",
  published: vi.fn(),
  mine: vi.fn(),
  installed: vi.fn(),
  pending: vi.fn(),
  detail: vi.fn(),
  submit: vi.fn(),
  review: vi.fn(),
  install: vi.fn(),
}));

vi.mock("#lib/permissions", () => ({
  usePermissions: () => ({
    ready: true,
    access: {
      isSiteAdmin: false,
      contexts:
        mocks.role === "centre"
          ? [{ contextLevel: 20, capabilities: ["tenant:manage"] }]
          : mocks.role === "reviewer"
            ? [{ contextLevel: 10, capabilities: ["systembank:review"] }]
            : [],
    },
  }),
}));

vi.mock("../api/programme-packages", () => ({
  fetchPublishedProgrammes: mocks.published,
  fetchMyProgrammes: mocks.mine,
  fetchInstalledProgrammes: mocks.installed,
  fetchPendingProgrammes: mocks.pending,
  fetchProgrammeForReview: mocks.detail,
  submitProgramme: mocks.submit,
  reviewProgramme: mocks.review,
  installProgramme: mocks.install,
}));

const published = {
  id: "pkg-1",
  version: "2026.11.13.1",
  status: "published",
  scope: "toan",
  checksum: "a".repeat(64),
  centreSlug: "trung-tam-a",
  outcomeCount: 1,
  createdAt: "",
  reviewedAt: "",
  rejectionReason: null,
};
const pending = {
  ...published,
  id: "pkg-2",
  version: "2026.11.13.2",
  status: "pending",
};

describe("Gói chương trình — theo vai người dùng", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = "centre";
    mocks.published.mockResolvedValue([published]);
    mocks.mine.mockResolvedValue([pending]);
    mocks.installed.mockResolvedValue([]);
    mocks.pending.mockResolvedValue([pending]);
    mocks.submit.mockResolvedValue({ package: pending });
    mocks.install.mockResolvedValue({ install: {}, unchanged: false });
    mocks.review.mockResolvedValue(published);
    mocks.detail.mockResolvedValue({
      package: pending,
      curricula: [
        {
          curriculumId: "curr-1",
          subjectSlug: "toan",
          subjectName: "Toán",
          grade: 6,
        },
      ],
      nodes: [
        {
          nodeId: "node-1",
          curriculumId: "curr-1",
          title: "Số tự nhiên",
          parentId: null,
        },
      ],
      outcomes: [
        {
          outcomeId: "out-1",
          nodeId: "node-1",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Đọc và viết số tự nhiên." }],
              },
            ],
          },
          sourceRef: "CTGDPT 2018",
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("trung tâm gửi đúng version và scope, cài được bản phát hành sau khi xác nhận", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <ProgrammePackagePanel subjects={[{ slug: "toan", name: "Toán" }]} />,
    );
    expect(
      await screen.findByText(/2026\.11\.13\.1 · toan/),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Mã phiên bản"), "2026.11.13.3");
    await userEvent.selectOptions(
      screen.getByLabelText("Phạm vi chương trình"),
      "toan",
    );
    await userEvent.click(screen.getByRole("button", { name: "Gửi duyệt" }));
    await waitFor(() =>
      expect(mocks.submit).toHaveBeenCalledWith("2026.11.13.3", "toan"),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Cài phiên bản" }),
    );
    await waitFor(() =>
      expect(mocks.install).toHaveBeenCalledWith("2026.11.13.1"),
    );
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("biên tập viên đọc nội dung rồi từ chối có lý do; không được gửi gói", async () => {
    mocks.role = "reviewer";
    render(<ProgrammePackagePanel subjects={[]} />);
    expect(
      await screen.findByText(/2026\.11\.13\.2 · trung-tam-a/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Gửi duyệt" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Xem nội dung" }));
    expect(
      await screen.findByText(/Đọc và viết số tự nhiên/),
    ).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText("Lý do từ chối"),
      "Thiếu minh chứng",
    );
    await userEvent.click(screen.getByRole("button", { name: "Từ chối" }));
    await waitFor(() =>
      expect(mocks.review).toHaveBeenCalledWith(
        "2026.11.13.2",
        false,
        "Thiếu minh chứng",
      ),
    );
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it("người chỉ xem không thấy thao tác và không tải danh mục theo vai quản trị", () => {
    mocks.role = "viewer";
    const { container } = render(<ProgrammePackagePanel subjects={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(mocks.published).not.toHaveBeenCalled();
  });
  it("hiện lịch sử cài đầy đủ theo phạm vi, phiên bản trước, checksum và thời gian", async () => {
    mocks.installed.mockResolvedValue([
      { id: "trace-2", packageVersion: "2026.11.13.2", packageChecksum: "c".repeat(64),
        scope: "toan", previousVersion: "2026.11.13.1", installedAt: "2026-11-13T12:00:00.000Z" },
      { id: "trace-1", packageVersion: "2026.11.13.1", packageChecksum: "a".repeat(64),
        scope: "toan", previousVersion: null, installedAt: "2026-11-12T12:00:00.000Z" },
    ]);
    render(<ProgrammePackagePanel subjects={[]} />);
    const history = await screen.findByRole("list", { name: "Lịch sử cài theo phạm vi" });
    expect(within(history).getAllByRole("listitem")).toHaveLength(2);
    expect(history).toHaveTextContent("2026.11.13.2");
    expect(history).toHaveTextContent("2026.11.13.1");
    expect(history).toHaveTextContent("c".repeat(64));
    expect(history).toHaveTextContent("a".repeat(64));
    expect(history).toHaveTextContent("Phiên bản trước");
    expect(history).toHaveTextContent("Thời điểm cài");
  });

  it.each([
    ["system_bank.curriculum_conflict", "môn/khối đã có chương trình"],
    ["system_bank.node_conflict", "node chương trình có cùng ID"],
    ["system_bank.outcome_conflict", "YCCĐ có cùng ID"],
  ])("hiện nguyên nhân nghiệp vụ của lỗi %s thay vì lỗi chung", async (code, message) => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.install.mockRejectedValueOnce(new ApiError({
      type: "about:blank", title: "Conflict", status: 409, code,
    }));
    render(<ProgrammePackagePanel subjects={[]} />);
    await screen.findByText(/2026\.11\.13\.1 · toan/);
    await userEvent.click(screen.getByRole("button", { name: "Cài phiên bản" }));
    expect(await screen.findByRole("status")).toHaveTextContent(message);
  });

});
