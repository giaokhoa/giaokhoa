# @giaokhoa/web — README nghiệp vụ

> File này ghi các **quyết định nghiệp vụ quan trọng và còn đang hiệu lực** của package. Nguồn sự thật về quyết định của package là chính file này, `AGENTS.md` của package và `AGENTS.md` ở thư mục gốc; quyết định liên quan tới một việc cụ thể được viết trọn vẹn trong issue đặc tả của việc đó trên GitHub. Quyết định đã bị đánh dấu "ĐÃ THAY THẾ" thì không ghi ở đây như còn hiệu lực.

## Package phụ trách nghiệp vụ gì

`apps/web` là toàn bộ bề mặt người dùng nhìn thấy: trang public, app/dashboard cho giáo viên, học sinh, phụ huynh và admin trung tâm/nền tảng. Web **trình bày và dẫn luồng** theo đúng nghiệp vụ sư phạm Việt Nam (tạo khoá theo khung CT GDPT 2018, ngân hàng câu hỏi/đề/ma trận, làm bài, sổ điểm, tin nhắn, thông báo) — mọi gác quyền và quy tắc bất biến nằm ở `apps/api`; web không tự "gác" nghiệp vụ bằng cách giấu nút/mục.

## Giao diện gửi duyệt và khám phá câu hệ thống (issue #13)

- Trong tab **Hệ thống** của Ngân hàng câu hỏi, quản trị trung tâm có `tenant:manage` tại context tenant thấy vùng **Công bố câu hỏi**: chọn câu `ready` từ danh sách câu hỏi trong bank riêng của trung tâm (kể cả câu do giáo viên khác soạn), nhập giấy phép nguồn (tuỳ chọn), gửi và xem lịch sử pending/approved/rejected cùng lý do. Bản `rejected` chỉ gửi lại sau khi chỉnh câu để sinh source version mới; gửi lại cùng phiên bản trả lỗi cụ thể thay vì báo thành công sai.
- Biên tập viên có `systembank:review` ở context hệ thống thấy hàng chờ gửi cùng bản xem trước đầy đủ tài liệu Tiptap (gồm ảnh đã sao sang kho hệ thống, ngữ liệu, phản hồi, hướng dẫn, lời giải và đáp án đúng/sai/tự luận), dấu vết tác giả/nguồn và manifest ảnh; có thể duyệt hoặc từ chối với lý do bắt buộc. Đây chỉ là điều kiện hiển thị; API gác quyền thật trước khi trả package hoặc ghi quyết định.
- Giáo viên có quyền ngân hàng thấy **Kho câu đã công bố**, lọc dạng câu, chọn version, xem trước qua API đã gác đáp án và nhập bản chụp về bank cá nhân. Chỉ câu đã duyệt xuất hiện; bộ lọc/phiên bản lấy từ API kho hệ thống, không trộn với hàng chờ đóng góp bank chung nội bộ đang hiện hữu.

## Quyết định nghiệp vụ còn hiệu lực

| Quyết định                                                                                                                                                                                                                                                                                                                                                  | Nguồn                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Kiến trúc hiển thị hybrid: **app/dashboard chạy SPA; CHỈ bề mặt public mới SSR**. (Nền React Router framework `ssr: true` từ GĐ4 giữ nguyên để phục vụ lớp public — README cũ ghi "SPA, ssr: false" là SAI, đã sửa ở bản này.)                                                                                                                              | Sổ mục F, chốt 25/10/2026 14:41; issue #7                         |
| Cấu trúc sidebar ngân hàng: 3 mục top-level — "Ngân hàng câu hỏi" (nút thu/mở riêng, một con "Ngữ liệu"), "Ngân hàng đề" (lá), "Ngân hàng ma trận" (lá). **BỎ hẳn mục "Ngân hàng hệ thống" ở sidebar** — khu hệ thống là tab "Hệ thống" trong từng màn danh sách ngân hàng (tab "Cá nhân" mặc định), hai tab chung khung danh sách, chỉ khác nguồn dữ liệu. | Sổ mục B, chốt lại 26/10/2026 11:40; issue #228                   |
| Dữ liệu ngân hàng có hai khu vực: "Ngân hàng hệ thống" (chung, tầng platform) và khu "của tôi" của từng giáo viên — trình bày bằng hai tab Cá nhân / Hệ thống trong cùng màn danh sách (xem dòng trên). Admin có khu riêng đúng như giáo viên.                                                                                                              | Sổ mục B, chốt 24–25/10/2026; trình bày chốt lại 26/10/2026 11:40 |
| Nhóm "Học tập" ở sidebar + command palette **chỉ hiện khi có dấu chân học tập**: (M) đang là học viên ≥1 khoá (đình chỉ vẫn tính) hoặc (A) ≥1 huy hiệu chưa bị thu hồi hoặc ≥1 kế hoạch học tập của chính mình. Ẩn điều hướng ≠ khoá trang.                                                                                                                 | Sổ mục B, chốt 25/10/2026; PR #190                                |
| Chuông thông báo ở header **ĐƯỢC GIỮ** như hiện tại. (Quyết định cũ "bỏ hẳn chuông, thông báo ở sidebar" ngày 23/10/2026 đã bị THAY THẾ — không làm theo nữa.)                                                                                                                                                                                              | Sổ mục C, chốt 25/10/2026 23:09; issue #174                       |
| Phân tầng tuỳ chọn thông báo trên UI: học sinh chỉ thấy tuỳ chọn TỐI THIỂU (tắt tiếng theo khoá); trang admin cấp site có mục cài đặt loại sự kiện được gửi. Ẩn ở UI không thay thế chặn ở API — API là nơi chặn thật.                                                                                                                                      | Sổ mục C, chốt 25/10/2026 23:09; issue #174 (lát NB-7)            |
| Luồng tạo khoá: lớp học tạo TRƯỚC, khoá nằm trong lớp. GV chưa có lớp mà tạo khoá thì wizard chèn bước tạo lớp nội tuyến (một trường tên) — KHÔNG sinh lớp mặc định ẩn.                                                                                                                                                                                     | Sổ mục A, chốt 25/10/2026 15:51; issue #184                       |
| Bề mặt học sinh làm bài **không hiển thị nguồn sách** của câu hỏi; phụ huynh/học sinh chỉ thấy điểm ĐÃ CÔNG BỐ (digest PH không mang điểm qua kênh ngoài — luật tối thiểu hoá kênh ngoài là luật cứng).                                                                                                                                                     | Sổ mục B + C (P4); issue #130/#133                                |
| Blog và hỏi-đáp: **ĐÃ GỠ** khỏi sản phẩm (không còn mục Blog trong điều hướng, không còn bề mặt hỏi-đáp). Không dựng lại hai bề mặt này khi chưa có lệnh mới.                                                                                                                                                                                               | Chốt 25/10/2026 21:55; issue #173                                 |
| Đóng băng mở rộng: chỉ hoàn thiện chức năng đang có; không tự thêm bề mặt/hướng mới (nội dung hệ thống công khai, TENANT-2/3/4…) khi chưa có lệnh.                                                                                                                                                                                                          | Sổ mục A, chốt 25/10/2026 15:07                                   |

## Ranh giới — package này KHÔNG làm gì

- Không chứa component shadcn/ui: toàn bộ lớp shadcn sống ở `packages/ui`; web chỉ dùng qua `@giaokhoa/ui/...`. Cấm sao chép component của package vào `src/components/` để sửa riêng (sẽ bị ghi đè mất ở lần đồng bộ shadcn kế tiếp). Component tự viết theo nghiệp vụ nằm ở `apps/web/src/components/`.
- Không chứa trình soạn thảo rich-text: dùng `packages/editor`.
- Không tự chế vỏ collapse/section riêng cho từng trang: dùng component dùng chung của dự án (vỏ thống nhất: trigger full-width, chevron, hover, tiêu đề nhất quán) — mỗi lát tự chế một kiểu vỏ là lỗi đã được ghi nhận (25/10/2026, trang /questions).
- Không chứa quy tắc nghiệp vụ: điểm số, quyền, trạng thái đều do API quyết; web chỉ hiển thị theo dữ liệu API trả.

## Kỹ thuật tối thiểu

- React + React Router framework mode + TanStack Query. Mọi trang chỉ dùng dữ liệu thật qua `src/lib/api.ts`; query key tập trung ở `src/lib/query-keys.ts`.
- Route đã đăng nhập tải dữ liệu phía client bằng cookie phiên Better Auth (client gửi kèm credentials cùng nguồn — xem `src/lib/api.ts` và `lib/auth-client.ts`); phía server, `lib/server-api.ts` đọc cùng cookie đó cho loader/SSR. Không còn token Bearer ở localStorage (đã chuyển sang cookie từ PR #257).
- Dev: `pnpm dev` (Vite proxy `/api`, `/socket.io`, `/mcp` và OAuth metadata về backend cổng 3000).
- Production: `@react-router/serve` chỉ phục vụ SSR + asset trên cổng nội bộ 3000; service Caddy ở `compose.yaml` làm reverse proxy và gắn CSP cho HTML theo `Caddyfile`. Không prerender trang dựa cookie; `/` và `/login` đều SSR theo request.

### Điều hướng theo trung tâm (issue #9)

Không hiển thị bộ chọn toàn bộ trung tâm theo một danh tính user chung.
Mỗi trung tâm có Host và kho tài khoản riêng; người dùng đăng nhập trên
địa chỉ của trung tâm mình, không chuyển tài khoản A sang B thông qua
danh bạ platform. Vỏ người dùng không còn menu chuyển trung tâm.
Màn registry vận hành tiếp tục quản lý metadata và vòng đời trung tâm
theo quyền platform, không suy ra quyền xem hồ sơ hoặc điểm của trung tâm.

## Quản trị quyền hỗ trợ có hạn (issue #19)

Trang `/admin/support-grants` của trung tâm, có liên kết từ `/admin/tenants` khi người dùng có quyền quản trị tại trung tâm đang hoạt động. Chủ trung tâm nhập UUID của nhân sự platform có membership active tại tenant vận hành `trang-chinh` (cấp bởi bộ phận vận hành, không phải tài khoản nghiệp vụ legacy), chọn chỉ-đọc danh sách lớp/khoá, đặt hạn tối đa 30 ngày và lý do; danh sách trạng thái hiển thị `Đang hiệu lực`, `Đã hết hạn`, `Đã thu hồi`. Sau khi API xác nhận cấp/thu hồi, trang làm mới grant và nhật ký cả quyết định được phép/lẫn bị từ chối. Giao diện không cho chọn tenant khác; API thực thi lại quyền `tenant:manage`, RLS, thời hạn và recipient mỗi request. Nhân sự hỗ trợ sử dụng endpoint vận hành riêng với support token giới hạn (`POST /auth/support/login` ở host gốc), không cần vai quản trị platform; không mượn danh người dùng trung tâm.

## Học liệu công bố trong Kho học liệu (issue #16)

Trang `/content-bank` giữ luồng soạn riêng/tải tệp hiện hữu và bổ sung panel **Học liệu hệ thống**. Quản trị trung tâm chọn học liệu của giáo viên từ danh sách rồi gửi; biên tập viên hệ thống xem tác giả/nguồn/giấy phép, tải bản chụp tệp hoặc mở liên kết và duyệt/từ chối kèm lý do. Lịch sử hiển thị trạng thái và phiên bản đã công bố.

Giáo viên chọn rõ một phiên bản, khoá có quyền quản hoạt động và section để **Dùng phiên bản trong khoá**. UI mở đường tới player hiện hữu sau khi API ghi nhận. Không yêu cầu nhập thành học liệu riêng hoặc mở form sửa bản công bố. Player hiển thị attribution/giấy phép/phiên bản và đọc media qua URL kiểm audience của tài nguyên khoá; mọi quyền được API kiểm lại, kể cả khi truy cập URL trực tiếp. Học viên không tải hàng chờ/gói ngân hàng qua panel. Tài liệu liên kết ngoài tiếp tục dùng trình bày liên kết/nhúng sẵn có; đây là tham chiếu URL, không phải bản sao byte bất biến, nên khả dụng phụ thuộc website ngoài. Muốn giữ byte không phụ thuộc nguồn phải gửi học liệu bằng tệp.
