import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "../../src/app/page";

describe("Trang chủ", () => {
  it("hiển thị nội dung công khai bằng tiếng Việt", () => {
    const html = renderToStaticMarkup(createElement(Home));

    expect(html).toContain("Một tài khoản, nhiều không gian học tập.");
  });

  it("dẫn đến endpoint đăng nhập của Spring, không tạo phiên riêng ở Next", () => {
    const html = renderToStaticMarkup(createElement(Home));

    expect(html).toContain('href="/oauth2/authorization/keycloak"');
  });
});
