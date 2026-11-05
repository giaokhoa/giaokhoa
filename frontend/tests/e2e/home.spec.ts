import { expect, test } from "@playwright/test";

test("trang chủ hiển thị liên kết đăng nhập", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Một tài khoản, nhiều không gian học tập." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Đăng nhập" })).toHaveAttribute(
    "href",
    "/oauth2/authorization/keycloak",
  );
});
