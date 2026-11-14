import { describe, expect, it } from "vitest";
import { boldSelection, linkSelection } from "./composer-format";

describe("Định dạng bản nháp tin nhắn và ghi chú", () => {
  it("bao vùng chọn bằng dấu đậm và tháo dấu đậm khi đã được bao", () => {
    expect(boldSelection("xin chào", 0, 8)).toBe("**xin chào**");
    expect(boldSelection("**xin chào**", 0, 12)).toBe("xin chào");
  });

  it("vùng chọn rỗng tạo cặp dấu định dạng để tiếp tục nhập", () => {
    expect(boldSelection("xin chào", 3, 3)).toBe("****");
  });

  it("liên kết bọc văn bản đã chọn và tự thêm giao thức cho tên miền", () => {
    expect(linkSelection("truy cập đây", 9, 12, " example.org ")).toBe(
      "[đây](https://example.org)",
    );
    expect(linkSelection("", 0, 0, "https://example.org")).toBe(
      "[https://example.org](https://example.org)",
    );
  });

  it("nhập liên kết rỗng không làm thay đổi bản nháp", () => {
    expect(linkSelection("nội dung", 0, 3, "  ")).toBeNull();
  });

  it("nhập liên kết null thì trả null thay vì ném lỗi", () => {
    expect(linkSelection("nội dung", 0, 3, null)).toBeNull();
  });
});
