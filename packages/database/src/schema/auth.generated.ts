import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  index,
} from "drizzle-orm/pg-core";

/**
 * Tài khoản người dùng do thư viện xác thực Better Auth quản lý, là gốc của phiên đăng nhập và tài khoản liên kết.
 * Tệp được tạo bằng công cụ Better Auth; các bảng nghiệp vụ chỉ tham chiếu tài khoản này thay vì tự lưu thông tin đăng nhập.
 */
export const users = pgTable("users", {
  /**
   * Mã người dùng duy nhất, sử dụng UUIDv7 do PostgreSQL tự cấp để các bảng nghiệp vụ tham chiếu.
   */
  id: uuid("id")
    .default(sql`uuidv7()`)
    .primaryKey(),
  /**
   * Tên hiển thị của người dùng trong giao diện và hồ sơ.
   */
  name: text("name").notNull(),
  /**
   * Địa chỉ thư điện tử dùng làm định danh đăng nhập; phải có và không được trùng tài khoản khác.
   */
  email: text("email").notNull().unique(),
  /**
   * Cho biết địa chỉ thư điện tử đã được xác minh hay chưa; mặc định là chưa xác minh.
   */
  emailVerified: boolean("email_verified").default(false).notNull(),
  /**
   * Đường dẫn hoặc địa chỉ ảnh đại diện, có thể để trống nếu người dùng chưa chọn ảnh.
   */
  image: text("image"),
  /**
   * Thời điểm tài khoản được tạo.
   */
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /**
   * Thời điểm thông tin tài khoản được cập nhật gần nhất; thư viện xác thực cập nhật khi có thay đổi.
   */
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  /**
   * Vai trò do tiện ích quản trị (admin plugin) của Better Auth sử dụng; có thể để trống tùy cách khởi tạo tài khoản.
   */
  role: text("role"),
  /**
   * Cờ đánh dấu tài khoản bị cấm sử dụng dịch vụ; mặc định là không.
   */
  banned: boolean("banned").default(false),
  /**
   * Lý do khóa tài khoản nếu người quản trị có ghi nhận.
   */
  banReason: text("ban_reason"),
  /**
   * Thời điểm hết hạn khóa tài khoản nếu lệnh khóa có giới hạn thời gian.
   */
  banExpires: timestamp("ban_expires"),
});

/**
 * Lưu phiên đăng nhập (session) để xác định người dùng đang được xác thực trong các yêu cầu.
 * Phiên bị xóa theo tài khoản nhằm tránh giữ thông tin xác thực khi người dùng không còn tồn tại.
 */
export const sessions = pgTable(
  "sessions",
  {
    /**
     * Mã phiên đăng nhập duy nhất, sử dụng UUIDv7 của PostgreSQL.
     */
    id: uuid("id")
      .default(sql`uuidv7()`)
      .primaryKey(),
    /**
     * Thời điểm phiên hết hạn; yêu cầu không được coi phiên đã hết hạn là đang đăng nhập.
     */
    expiresAt: timestamp("expires_at").notNull(),
    /**
     * Mã bí mật nhận diện phiên (session token), phải duy nhất và không được xuất hiện trong nội dung công khai.
     */
    token: text("token").notNull().unique(),
    /**
     * Thời điểm phiên đăng nhập được tạo.
     */
    createdAt: timestamp("created_at").defaultNow().notNull(),
    /**
     * Thời điểm gần nhất thông tin phiên được thay đổi.
     */
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    /**
     * Địa chỉ mạng IP khi ghi nhận phiên, có thể trống tùy thông tin từ yêu cầu.
     */
    ipAddress: text("ip_address"),
    /**
     * Thông tin trình duyệt hoặc ứng dụng khách (user agent) gắn với phiên, có thể trống.
     */
    userAgent: text("user_agent"),
    /**
     * Tài khoản sở hữu phiên; khi xóa tài khoản, phiên liên quan bị xóa theo.
     */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * Mã người quản trị thực hiện đăng nhập thay (impersonation) nếu phiên được tạo trong chế độ đó.
     */
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("sessions_userId_idx").on(table.userId)],
);

/**
 * Liên kết người dùng với phương thức đăng nhập và nhà cung cấp danh tính (identity provider).
 * Tách thông tin đăng nhập khỏi hồ sơ người dùng để một tài khoản có thể sử dụng nhiều nhà cung cấp hoặc mật khẩu.
 */
export const accounts = pgTable(
  "accounts",
  {
    /**
     * Mã bản ghi liên kết đăng nhập duy nhất, được cấp UUIDv7.
     */
    id: uuid("id")
      .default(sql`uuidv7()`)
      .primaryKey(),
    /**
     * Mã tài khoản do nhà cung cấp đăng nhập nhận diện; ý nghĩa cụ thể tùy nhà cung cấp.
     */
    accountId: text("account_id").notNull(),
    /**
     * Mã nhà cung cấp danh tính hoặc phương thức đăng nhập để phân biệt các tài khoản có cùng mã bên ngoài.
     */
    providerId: text("provider_id").notNull(),
    /**
     * Người dùng nội bộ sở hữu liên kết đăng nhập; liên kết bị xóa khi tài khoản người dùng bị xóa.
     */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * Mã truy cập (access token) do nhà cung cấp cấp, có thể trống và cần được bảo vệ như dữ liệu bí mật.
     */
    accessToken: text("access_token"),
    /**
     * Mã làm mới (refresh token) nếu nhà cung cấp hỗ trợ gia hạn quyền truy cập.
     */
    refreshToken: text("refresh_token"),
    /**
     * Mã định danh (ID token) của nhà cung cấp xác thực khi giao thức đăng nhập sử dụng.
     */
    idToken: text("id_token"),
    /**
     * Thời điểm mã truy cập hết hạn nếu nhà cung cấp cung cấp thông tin này.
     */
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    /**
     * Thời điểm mã làm mới hết hạn nếu có.
     */
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    /**
     * Phạm vi quyền truy cập được nhà cung cấp cấp (scope), lưu để biết phạm vi của mã xác thực.
     */
    scope: text("scope"),
    /**
     * Giá trị xác thực mật khẩu đã được xử lý bởi Better Auth; không phải nơi lưu mật khẩu rõ của người dùng.
     */
    password: text("password"),
    /**
     * Thời điểm tạo liên kết đăng nhập.
     */
    createdAt: timestamp("created_at").defaultNow().notNull(),
    /**
     * Thời điểm thông tin liên kết hoặc mã xác thực được thay đổi gần nhất.
     */
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("accounts_userId_idx").on(table.userId)],
);

/**
 * Dữ liệu xác minh tạm thời (verification), phục vụ các bước kiểm chứng danh tính hoặc địa chỉ liên hệ.
 * Giữ thời hạn hết hiệu lực riêng để không chấp nhận lại dữ liệu xác minh đã hết hạn.
 */
export const verifications = pgTable(
  "verifications",
  {
    /**
     * Mã bản ghi xác minh duy nhất do PostgreSQL cấp UUIDv7.
     */
    id: uuid("id")
      .default(sql`uuidv7()`)
      .primaryKey(),
    /**
     * Định danh đang được xác minh, chẳng hạn địa chỉ thư điện tử hoặc mã đối tượng theo quy trình xác thực.
     */
    identifier: text("identifier").notNull(),
    /**
     * Giá trị xác minh do Better Auth quản lý; cần bảo vệ vì có thể liên quan đến mã xác thực tạm thời.
     */
    value: text("value").notNull(),
    /**
     * Thời điểm dữ liệu xác minh hết hiệu lực.
     */
    expiresAt: timestamp("expires_at").notNull(),
    /**
     * Thời điểm tạo yêu cầu xác minh.
     */
    createdAt: timestamp("created_at").defaultNow().notNull(),
    /**
     * Thời điểm gần nhất giá trị xác minh được cập nhật.
     */
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));
