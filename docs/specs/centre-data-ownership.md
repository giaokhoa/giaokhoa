# Chuẩn hoá dữ liệu trung tâm và tài nguyên dùng chung

Đặc tả được công bố tại [issue #6](https://github.com/giaokhoa/giaokhoa/issues/6)
với nhãn `ready-for-agent`, làm cơ sở phân rã các issue thi công.

## Bối cảnh và vấn đề

Trung tâm cần sở hữu tài khoản, hồ sơ, dữ liệu học tập và vòng đời dữ liệu
của mình, đồng thời khai thác ngân hàng tài nguyên chung của nền tảng. Một
trung tâm phải tạo được đề riêng từ câu hỏi chung, hoặc giao một đề chung
cho học sinh của mình làm và chấm, với kết quả thuộc riêng trung tâm.

Mã nguồn hiện có đường cấp phát database và tài khoản riêng, nhưng vẫn giữ
chế độ kho chung, liên kết người dùng xuyên trung tâm và các khái niệm ngân
hàng chung trùng lặp. Ngân hàng hệ thống riêng hiện mới bao phủ câu hỏi và
gói chương trình/yêu cầu cần đạt; câu chung phải được nhập thành câu trong
kho trung tâm trước khi đưa vào đề. Luồng đề chung giữa các database riêng
chưa đầy đủ. File vật lý đang dùng khoá hash chung, trong khi phạm vi tham
chiếu và dọn file cần được kiểm chứng theo từng kho.

Khảo sát hiện tại là đọc tĩnh: chưa xác minh registry của môi trường đang
vận hành, chưa chạy lại các test cách ly và không kết luận đã xảy ra truy
cập chéo hoặc mất dữ liệu. Không có yêu cầu bảo toàn dữ liệu hiện tại khi
chuẩn hoá mô hình đích.

## Mục tiêu

1. Mỗi trung tâm có database, quyền kết nối, tài khoản và vùng lưu file riêng;
   xuất, sao lưu, khôi phục và xoá độc lập.
2. Dùng chung API, worker, cụm PostgreSQL và Redis, ưu tiên vận hành gọn.
3. Có một ngân hàng toàn hệ thống cho câu hỏi, đề mẫu, học liệu và chương
   trình; quyền sở hữu dữ liệu trung tâm không bị nhập vào ngân hàng này.
4. Tái sử dụng nguyên trạng qua tham chiếu phiên bản cố định; tạo bản riêng
   khi cần sửa và tự lưu bản chụp phục vụ thi/chấm.
5. Bảo toàn chức năng học tập của trung tâm và khu học tập công cộng, loại bỏ
   hành vi legacy không còn phù hợp với mô hình đích.

## Phạm vi

### Làm

- Chuẩn hoá cấp phát, định tuyến, phân quyền database và nhận diện trung tâm.
- Tách tài khoản, hồ sơ, phiên, dữ liệu nghiệp vụ, file và xử lý nền theo
  trung tâm; tổ chức khu học tập công cộng như một trung tâm có dữ liệu riêng.
- Giới hạn control plane ở metadata vận hành, bỏ liên kết tài khoản người
  dùng giữa các trung tâm.
- Hoàn thiện ngân hàng tài nguyên chung, quy trình gửi/duyệt, phiên bản,
  tham chiếu, tạo bản riêng và thông báo thay đổi/rút nguồn.
- Hoàn thiện tạo đề riêng từ câu chung và giao đề chung, bản chụp thực thi,
  lượt làm, chấm, nhận xét và công bố điểm trong trung tâm.
- Hoàn thiện sao lưu/khôi phục tự đủ và quyền hỗ trợ có thời hạn/audit.
- Đồng bộ hợp đồng API, giao diện, dữ liệu khởi tạo, tài liệu và các kiểm
  chứng liên quan tới những hành vi trên.

### Không làm

- Không di trú dữ liệu hiện tại, giữ tương thích với chế độ kho chung của
  trung tâm, hoặc giữ thư mục liên kết người dùng xuyên trung tâm.
- Không tách một bộ API/worker/cụm PostgreSQL/Redis cho từng trung tâm.
- Không xây SSO hoặc tự liên kết tài khoản bằng email/số điện thoại.
- Không đồng bộ sống nội dung đã giao theo phiên bản nguồn mới nhất.
- Không thay đổi luật chấm, công bố điểm hay nghiệp vụ học tập ngoài phần
  cần thiết để hỗ trợ nguồn tài nguyên chung và dữ liệu trung tâm riêng.
- Không bổ sung chính sách kinh doanh, thu phí tài nguyên, DRM hoặc quy
  định giấy phép mới; giữ thông tin nguồn và các kiểm tra giấy phép hiện có.
- Không thay toàn bộ framework, ORM, queue hoặc hạ tầng; không dọn mã ngoài
  phạm vi sở hữu dữ liệu và tài nguyên này.
- Không cam kết số trung tâm, thông lượng, độ trễ, RPO/RTO hoặc SLA khi chưa
  có mục tiêu định lượng và kết quả đo tải.

## Chi tiết việc cần làm

### Giải pháp từ góc nhìn người sử dụng

Trung tâm quản lý học sinh, giáo viên, lớp, khoá, đề riêng, bài làm, điểm,
nhận xét, thanh toán và file trong phạm vi riêng. Người dùng cùng email ở
hai trung tâm là hai tài khoản độc lập, có mật khẩu, phiên và trạng thái riêng.

Giáo viên có thể mở ngân hàng chung, chọn phiên bản câu hỏi để ghép thành đề
riêng, kết hợp với câu riêng của trung tâm; hoặc chọn một đề chung và giao
cho lớp. Việc sử dụng nguyên trạng không yêu cầu thao tác Copy hay tạo câu/đề
có thể biên tập trong ngân hàng riêng. Khi cần đổi nội dung nguồn, người dùng
tạo bản riêng của trung tâm để sửa.

Mỗi đợt giao đề có lớp/nhóm, lịch và cấu hình làm bài/chấm của trung tâm.
Hệ thống tự giữ nội dung, đáp án, quy tắc chấm và tệp cần thiết dưới dạng bản
chụp phục vụ thi/chấm. Bài làm, điểm, nhận xét và lịch sử thuộc trung tâm,
không được đưa vào ngân hàng chung. Sửa hay rút bản nguồn không sửa ngược
nội dung đã giao hoặc kết quả đã có.

Giáo viên chuẩn bị tài nguyên trong trung tâm. Quản trị trung tâm gửi tài
nguyên thay mặt đơn vị sở hữu, ban biên tập hệ thống duyệt công bố. Quản trị
nền tảng chỉ có quyền vận hành mặc định; hỗ trợ dữ liệu nghiệp vụ cần trung
tâm cấp quyền hữu hạn và được audit.

### Câu chuyện người dùng

1. Là quản trị nền tảng, cần tạo trung tâm với kho và quyền kết nối riêng để
   trung tâm bắt đầu hoạt động trong một ranh giới dữ liệu rõ ràng.
2. Là quản trị trung tâm, cần quản lý tài khoản và hồ sơ trong đơn vị mình
   để trung tâm khác không truy cập hoặc thay đổi được.
3. Là người học tại hai trung tâm, cần hai tài khoản độc lập dù dùng cùng
   email để một nơi đổi mật khẩu hoặc đình chỉ không ảnh hưởng nơi kia.
4. Là người dùng trung tâm, cần phiên đăng nhập bị từ chối ở trung tâm khác
   để việc đổi hostname hoặc định danh trong request không vượt phạm vi.
5. Là giáo viên, cần ngân hàng cá nhân thuộc trung tâm đang làm việc để
   tài nguyên không tự xuất hiện tại một trung tâm khác của cùng người.
6. Là giáo viên/học viên tự do, cần tiếp tục học trong khu công cộng có dữ
   liệu riêng để chức năng học tập trên site chính được giữ lại.
7. Là giáo viên, cần khám phá câu hỏi, đề mẫu, học liệu và chương trình đã
   công bố trong ngân hàng hệ thống để tìm tài nguyên phù hợp.
8. Là giáo viên, cần biết nguồn và phiên bản tài nguyên mình chọn để có thể
   đối chiếu chính xác nội dung đã sử dụng.
9. Là giáo viên, cần chọn câu chung tạo đề riêng trực tiếp để không phải
   nhập từng câu vào ngân hàng riêng trước.
10. Là giáo viên, cần trộn câu chung với câu riêng trong cùng đề để phù hợp
    nội dung giảng dạy của trung tâm.
11. Là giáo viên, cần giao nguyên một đề chung cho lớp của mình để dùng lại
    nội dung đã được biên tập mà vẫn tổ chức thi độc lập.
12. Là giáo viên, cần đặt lớp/nhóm đích, lịch, giới hạn làm bài và cấu hình
    chấm của đợt giao để phù hợp hoạt động của trung tâm.
13. Là giáo viên, cần tạo bản riêng khi sửa câu hoặc đề chung để chỉnh sửa
    không tác động nguồn và các trung tâm khác.
14. Là giáo viên, cần tạo và sửa đề riêng từ các nguồn đã chọn để quyền
    biên tập nội dung của mình không phụ thuộc vào quyền sửa ngân hàng chung.
15. Là học sinh, cần làm bài được giao tại trung tâm mình để bài làm và kết
    quả không được lưu vào tài khoản hay lớp ở nơi khác.
16. Là học sinh, cần chỉ thấy nội dung, phản hồi và điểm được phép công bố
    để đáp án hoặc điểm chưa công bố không bị lộ qua nguồn chung.
17. Là giáo viên chấm bài, cần chấm tự động và chấm tay theo phiên bản đã
    giao để kết quả không thay đổi khi bản nguồn có phiên bản mới.
18. Là giáo viên, cần tiếp tục chấm và xem lịch sử của đợt giao đã sẵn sàng
    khi ngân hàng chung không truy cập được.
19. Là quản trị trung tâm, cần dữ liệu học sinh, bài làm, điểm và nhận xét
    nằm trong kho mình để có thể xuất, sao lưu và khôi phục độc lập.
20. Là giáo viên, cần nhận thông báo phiên bản mới để chủ động quyết định
    sử dụng ở đề/đợt giao tiếp theo.
21. Là giáo viên, cần được cảnh báo khi nguồn bị rút nhưng vẫn giữ nội dung
    đã tiếp nhận và lịch sử để kiểm tra, sử dụng hoặc thay thế chủ động.
22. Là người khám phá ngân hàng, cần không tiếp nhận mới tài nguyên đã rút
    để không bắt đầu sử dụng một nguồn không còn được công bố.
23. Là giáo viên, cần tài nguyên mới tạo mặc định riêng trong trung tâm để
    việc tạo nội dung không đồng nghĩa tự động chia sẻ ra ngoài.
24. Là quản trị trung tâm, cần chủ động gửi tài nguyên lên ngân hàng để đơn
    vị sở hữu kiểm soát hành động chia sẻ.
25. Là biên tập viên hệ thống, cần duyệt, từ chối kèm lý do và phát hành
    phiên bản để ngân hàng chỉ phục vụ nội dung đã được duyệt.
26. Là quản trị trung tâm, cần file có vùng lưu và vòng đời riêng để xoá
    file ở trung tâm khác không làm hỏng nội dung của mình.
27. Là quản trị trung tâm, cần bản sao lưu gồm dữ liệu và file để khôi phục
    được hoạt động mà không phụ thuộc vào trạng thái hiện thời của nguồn.
28. Là quản trị trung tâm, cần xuất, khôi phục và xoá dữ liệu của mình mà
    không thay đổi dữ liệu, file hoặc kết quả của trung tâm khác.
29. Là người vận hành, cần job, cache, tìm kiếm và realtime có phạm vi trung
    tâm rõ ràng để tác vụ nền không xử lý nhầm kho.
30. Là người vận hành, cần xem registry, phiên bản schema, gói dịch vụ và
    trạng thái vận hành mà không được mặc nhiên đọc dữ liệu học tập.
31. Là quản trị trung tâm, cần cấp quyền hỗ trợ có người nhận, phạm vi và
    thời điểm hết hạn cụ thể để kiểm soát truy cập nghiệp vụ.
32. Là quản trị trung tâm, cần thu hồi quyền hỗ trợ trước hạn và xem audit
    để truy cập tiếp theo bị chặn và hành động trước đó được đối chiếu.
33. Là người hỗ trợ, cần chỉ thực hiện thao tác được cấp ở đúng trung tâm
    để hỗ trợ một đơn vị không mở quyền ở các đơn vị còn lại.
34. Là người vận hành, cần theo dõi pool/kết nối và tải worker để điều chỉnh
    tài nguyên chung dựa trên số liệu thay vì tăng hạ tầng theo giả định.
35. Là người cài đặt hệ thống, cần dựng mới được mô hình đích nhất quán để
    không phải đi qua luồng di trú dữ liệu cũ hoặc giữ hai chế độ trung tâm.
36. Là người phát triển, cần tài liệu, dữ liệu khởi tạo và kiểm chứng cùng
    thể hiện mô hình đích để hành vi legacy không quay lại ở lần sửa sau.

### Quyết định triển khai

#### Miền sở hữu và vòng đời

- Có các miền dữ liệu riêng: kho nghiệp vụ từng trung tâm, kho khu học tập
  công cộng, ngân hàng hệ thống và control plane phục vụ vận hành.
- Khu công cộng dùng cùng quy tắc tài khoản, file, phân quyền và vòng đời
  như một trung tâm; không trộn hồ sơ học tập vào ngân hàng hệ thống.
- Một trung tâm có định danh kho ổn định để định tuyến và đặt phạm vi file,
  cache/job. Đổi tên hiển thị hoặc hostname không làm đổi quyền sở hữu.
- Tài khoản và phiên thuộc kho trung tâm. Không tìm user của trung tâm khác
  hoặc kho cũ để thay cho user không tồn tại tại kho đã xác định.
- Hồ sơ, quan hệ người dùng và audit nghiệp vụ thuộc trung tâm. Tài khoản
  nhân sự vận hành là định danh vận hành, không phải định danh chung của
  người học/giáo viên giữa các trung tâm.
- Control plane giữ registry, cấu hình kết nối dạng tham chiếu bí mật, trạng
  thái, gói dịch vụ, phiên bản schema và metadata vận hành cần thiết; loại bỏ
  thư mục liên kết người dùng xuyên trung tâm.

#### Cấp phát, định tuyến và dữ liệu

- Tận dụng các miền cấp phát trung tâm, định tuyến, nhận diện và repository
  hiện có; mọi trung tâm đích dùng database và quyền kết nối riêng.
- Kiểm chứng hostname/ngữ cảnh/phiên trước truy vấn. Ngữ cảnh trung tâm
  thiếu, sai, bị thu hồi hoặc chưa sẵn sàng phải báo lỗi; không đổi đích
  truy vấn sang kho khác để tiếp tục xử lý.
- Giữ RLS fail-closed và nguyên tắc quyền tối thiểu của kho trung tâm.
  Role runtime của A không được đọc/ghi hoặc kết nối vào kho B.
- Dùng Kysely và bộ migration hiện có; repository nhận đúng handle kho,
  không tự đọc cấu hình hoặc tự mở kết nối. Mỗi giao dịch chỉ dùng một
  handle; không giả định tính nguyên tử giữa các database.
- Tham chiếu giữa kho trung tâm và ngân hàng được kiểm chứng ở ranh giới
  nghiệp vụ; không giả định FK hoặc truy vấn liên kết xuyên database.
- Chuẩn hoá schema/seed cho cài mới. Giữ các carrier migration đóng băng và
  RLS viết tay theo quy định repo; không tự regen baseline làm mất các bảo vệ.

#### File, xử lý nền và hạ tầng dùng chung

- File có miền sở hữu trung tâm hoặc ngân hàng hệ thống; key, quyền tải,
  URL có ký, tham chiếu và cleanup phải giữ miền sở hữu này.
- Hai trung tâm có nội dung cùng hash vẫn có vòng đời file độc lập. Dedupe
  trong cùng miền không được biến thành quyền xoá nội dung của miền khác.
- Job mang định danh kho và phạm vi thực thi cần thiết; xác định kho trước
  khi đọc, ghi, retry hoặc dọn file. Job thiếu/sai phạm vi bị từ chối.
- Cache, khoá, kết quả tìm kiếm và kênh realtime phải giữ phạm vi trung tâm;
  cùng một định danh nghiệp vụ ở hai kho không được làm dùng lẫn dữ liệu.
- Giữ pool lười và thu hồi nhàn rỗi; kiểm đếm số pool/kết nối và trần kết
  nối toàn hệ thống theo số tiến trình, phần dự phòng vận hành và tải đo.
  Không thêm proxy/pooler hay hạ tầng mới trước khi có nhu cầu đo được.

#### Ngân hàng tài nguyên và công bố

- Một ngân hàng hệ thống phục vụ câu hỏi, đề mẫu, học liệu và chương trình;
  phân biệt tài nguyên, phiên bản bất biến và trạng thái công bố.
- Tài nguyên trung tâm tạo mặc định riêng. Giáo viên chuẩn bị nội dung;
  quản trị trung tâm gửi; biên tập viên hệ thống duyệt trước khi công bố.
- Bản công bố và tệp phụ thuộc thuộc miền ngân hàng, không phụ thuộc vòng
  đời file riêng của trung tâm gửi. Giữ nguồn, tác giả và thông tin giấy phép
  phù hợp; không đưa bài làm hoặc hồ sơ học sinh vào nội dung công bố.
- Phiên bản đã công bố/được tham chiếu không bị sửa tại chỗ. Cập nhật tạo
  phiên bản mới, giữ định danh/phiên bản/checksum và nguồn để truy vết.
- Metadata phân phối có thể ghi nhận trung tâm và phiên bản đã sử dụng để
  bảo vệ vòng đời phiên bản/thông báo; không tạo danh bạ người dùng chung.
- Loại bỏ cơ chế ngân hàng toàn cục cũ trùng lặp với mô hình đích; ngân hàng
  cá nhân của giáo viên là tài nguyên trong trung tâm của tài khoản đó.

#### Tham chiếu, tạo bản riêng và giao đề

- Tham chiếu phải xác định miền nguồn, loại tài nguyên, tài nguyên và phiên
  bản bất biến; kiểm quyền sử dụng nguồn cùng quyền tạo/giao ở đích.
- Tạo đề riêng từ câu chung không bắt buộc tạo câu có thể biên tập trong
  ngân hàng trung tâm. Một đề có thể chứa câu riêng và tham chiếu câu chung.
- Giao đề chung tạo đợt giao thuộc trung tâm, ghim phiên bản đề và các phụ
  thuộc cần thiết, có lớp/nhóm, lịch và cấu hình làm bài/chấm riêng.
- Khi sửa nội dung nguồn, tạo bản riêng có thông tin nguồn; không cấp quyền
  sửa ngân hàng chung hoặc cập nhật các trung tâm khác qua thao tác này.
- Phiên bản nguồn mới chỉ tạo thông báo. Trung tâm chủ động nhận cho việc
  sử dụng tiếp theo, không tự cập nhật đợt giao/lượt làm đã cố định.

#### Bản chụp thực thi, chấm và lịch sử

- Trước khi một đợt giao sẵn sàng cho học sinh làm, hệ thống tự lưu đủ nội
  dung, đáp án, phụ thuộc và quy tắc chấm cần thiết để vận hành từ kho trung
  tâm. Nguồn có thể được đọc ở bước chuẩn bị, không đọc sống để quyết định
  nội dung/đáp án của một lượt làm đã cố định.
- Bản chụp thực thi bất biến và được phân biệt với bản riêng để biên tập.
  Không yêu cầu người dùng thực hiện Copy; không yêu cầu tạo một bản đề
  có thể biên tập cho từng học sinh.
- Bài làm, câu trả lời, điểm tự động/thủ công, nhận xét, lịch sử chấm và
  trạng thái công bố thuộc trung tâm. Không ghi chúng vào kho ngân hàng.
- Giữ luật chấm và công bố hiện có: hỗ trợ chấm tự động/chấm tay; học sinh
  và phụ huynh chỉ thấy điểm được công bố. Đáp án/nhận xét chưa được phép
  xem không xuất hiện trong response chỉ vì nguồn là tài nguyên chung.
- Lưu thao tác giao/cập nhật nguồn theo cách thử lại không tạo bản ghi trùng.
  Thiếu quyền, gói hỏng, phiên bản thiếu hoặc lưu snapshot lỗi thì không để
  lại đợt giao sẵn sàng nhưng thiếu nội dung hoặc dữ liệu thi một phần.
- Với thao tác qua nhiều kho, dùng thứ tự commit, trạng thái và outbox/retry
  hiện có để đạt hành vi nhất quán; không mở giao dịch phân tán mới.

#### Rút tài nguyên và sự cố ngân hàng

- Rút nguồn ngừng khám phá và tiếp nhận mới từ ngân hàng, giữ các phiên bản
  đã được tham chiếu và cảnh báo các trung tâm đã sử dụng.
- Trung tâm đã tiếp nhận một phiên bản vẫn giữ quyền dùng phiên bản đã
  ghim, bản riêng và bản chụp; có thể tiếp tục dùng lại trong trung tâm và
  chủ động thay thế. Trung tâm chưa tiếp nhận không được bắt đầu dùng nguồn
  đã rút thông qua việc đoán định danh hoặc gọi API trực tiếp.
- Ngân hàng không sẵn sàng có thể chặn khám phá/tiếp nhận mới, nhưng đợt giao
  đã sẵn sàng vẫn làm, chấm và xem lịch sử bằng dữ liệu ở trung tâm.
- Xoá trung tâm gửi không làm mất bản công bố độc lập trong ngân hàng hoặc
  nội dung đã được trung tâm khác sử dụng. Rút nguồn không phải xoá lịch sử.

#### Sao lưu, xuất, khôi phục và xoá

- Đơn vị xuất/sao lưu của trung tâm gồm dữ liệu nghiệp vụ, tài khoản/quan
  hệ cần khôi phục, bản chụp thực thi và file do hệ thống quản lý tương ứng;
  có manifest phiên bản, miền sở hữu và kiểm tra toàn vẹn.
- Cơ chế sao lưu phải xác định được tập database/file nhất quán, thay vì
  coi dump database đơn lẻ là đã đủ. Tận dụng pipeline fleet và công cụ
  backup/restore hiện có, kiểm thử phục hồi trong môi trường cô lập.
- Khôi phục trung tâm tái hiện được nội dung đã thi, đáp án/quy tắc chấm,
  điểm và file ngay cả khi nguồn chung đã cập nhật/rút hoặc không truy cập
  được. Không tự nối lại tài khoản sang người dùng của trung tâm khác.
- Xuất, backup, restore và xoá của A không đọc dữ liệu riêng hoặc đổi trạng
  thái của B/khu công cộng. Xoá chỉ áp dụng đúng miền sở hữu và tài nguyên
  mà miền đó có quyền quản lý, giữ các bản công bố/bản dùng độc lập ở nơi khác.

#### Quyền hỗ trợ

- Quyền vận hành nền tảng không tự cho đọc hồ sơ, nội dung riêng, bài làm
  hoặc điểm trung tâm. Đường login-as có lý do/audit đơn thuần không thay
  thế quyền hỗ trợ mà trung tâm phải cấp.
- Quản trị trung tâm cấp quyền cho người hỗ trợ cụ thể, tại đúng trung tâm,
  với phạm vi thao tác và thời điểm hết hạn hữu hạn. Không có quyền hỗ trợ
  vô hạn ngầm định; thao tác ngoài phạm vi hoặc ở trung tâm khác bị từ chối.
- Mỗi lần truy cập kiểm trạng thái quyền hiện thời. Hết hạn hoặc bị thu hồi
  chặn request tiếp theo, kể cả người hỗ trợ còn phiên đăng nhập.
- Ghi cấp, sử dụng và thu hồi quyền vào audit có trung tâm, chủ thể, phạm
  vi, thời gian và kết quả; không ghi bí mật hoặc toàn bộ dữ liệu nhạy cảm
  vào log vận hành chung. Trung tâm xem được audit hỗ trợ dữ liệu của mình.

#### Hợp đồng API và trải nghiệm

- Mở rộng các miền tài nguyên, đề, đợt giao và snapshot hiện có; hợp đồng
  API phân biệt nguồn riêng/chung, phiên bản đã ghim, bản riêng và bản chụp.
- Giao diện cho phép chọn câu chung khi tạo đề và chọn đề chung khi giao
  bài; hiển thị nguồn/phiên bản cùng hành động tạo bản riêng khi sửa.
- Cập nhật/rút nguồn có trạng thái và thông báo rõ, không làm người dùng
  tưởng nội dung đã giao bị thay đổi tự động.
- Mọi validation dùng Zod qua hợp đồng dùng chung; giao diện và thông báo
  dùng i18n hiện có. Mã lỗi/định danh kỹ thuật bằng tiếng Anh, tài liệu và
  mô tả test bằng tiếng Việt; giữ quy tắc che thông tin nguồn sách phía học sinh.
- Đồng bộ tài liệu nghiệp vụ API/DB/worker/web trong cùng thay đổi khi hành
  vi shared hoặc ngân hàng cũ được thay thế; không để tài liệu mô tả mô hình
  cũ như quyết định còn hiệu lực.

### Quyết định kiểm thử

#### Các ranh giới kiểm chứng

Phạm vi kiểm chứng được xác nhận gồm hai điểm vào chính và kiểm thử giao diện
bổ sung, tận dụng các ranh giới hiện có:

1. HTTP của ứng dụng NestJS đầy đủ, kích hoạt bằng supertest: đăng nhập,
   cách ly, công bố/khám phá nguồn, tạo đề, giao bài, làm/chấm, điểm và quyền
   hỗ trợ. Dùng ba miền học tập A, B, công cộng cùng một ngân hàng riêng.
2. CLI/queue hiện có cho cấp phát, xử lý job, cleanup và backup/restore:
   quan sát database, file và kết quả sau khi chạy tác vụ thật trong môi
   trường test. Test gọi trực tiếp service được xếp integration, không e2e.
3. Kiểm thử tương tác giao diện cho chọn câu chung/tạo đề riêng, giao đề
   chung và tạo bản riêng khi sửa; kiểm chứng hành vi qua công cụ test web
   hiện có, không thêm một framework trình duyệt chỉ để thực hiện đặc tả này.

Không tạo API vận hành mới chỉ để test. Không khoá tên helper, cách phân lớp,
số lần gọi repository hoặc hình dạng trung gian nếu chúng không phải hợp đồng
nghiệp vụ; kiểm kết quả, quyền bị từ chối, dữ liệu tồn tại và tác động chéo.

#### Tiền lệ và tầng test

- Tận dụng các suite cách ly tenant, space routing, membership, phiên/token
  và messaging socket đang có; sửa assertion theo mô hình đích, không yếu
  hoá assertion để giữ hành vi legacy.
- Tận dụng suite system-bank về phiên bản bất biến, checksum, rút nguồn,
  truy vết và bank-off; mở rộng từ câu đã nhập sang tham chiếu và bản chụp
  thực thi cho câu/đề chung.
- Tận dụng suite đề/quiz về ghim phiên bản, làm bài, chấm tự động/thủ công,
  nhóm đích, công bố điểm và phục hồi lịch sử.
- Tận dụng suite fleet và worker space-job-routing cho vận hành nhiều kho,
  backup/restore và xử lý nền.
- Tầng unit chỉ khoá logic thuần có rủi ro như kiểm gói/phiên bản/toàn vẹn;
  integration dùng database thật cho quyền kết nối, RLS và vòng đời storage.
- Backend e2e ở tầng HTTP, integration ở tầng gọi trực tiếp service/hạ tầng,
  unit cạnh mã nguồn. Giữ các project Vitest và glob tường minh của từng tầng;
  test nặng local giữ khoá và database tách biệt theo quy định repo.

Các tiêu chí nghiệm thu dưới đây là các kịch bản bắt buộc; kiểm cả phản hồi
từ điểm vào và trạng thái lưu trữ đúng kho. Không công bố chúng đã đạt chỉ
vì có nội dung đặc tả hoặc vì một head trước đó có CI xanh.

## Việc con dự kiến

- [ ] Chuẩn hoá cấp phát, định tuyến, tài khoản và khu học tập công cộng.
- [ ] Chuẩn hoá control plane và loại bỏ liên kết người dùng xuyên trung tâm.
- [ ] Cách ly file, job, cache, tìm kiếm và realtime theo miền sở hữu.
- [ ] Hoàn thiện xuất, backup, restore và xoá độc lập gồm database cùng file.
- [ ] Hoàn thiện ngân hàng chung và luồng quản trị trung tâm gửi/hệ thống duyệt.
- [ ] Hỗ trợ tham chiếu phiên bản, tạo bản riêng và thay đổi/rút nguồn.
- [ ] Hỗ trợ tạo đề riêng từ câu chung, giao đề chung và snapshot thực thi.
- [ ] Hoàn thiện quyền hỗ trợ hữu hạn, thu hồi và audit.
- [ ] Đồng bộ API/web, schema/seed, tài liệu và kiểm chứng tải/kết nối.
- [ ] Chứng minh các tiêu chí nghiệm thu trên cây tích hợp và CI đúng head.

## Quyết định liên quan

1. Trung tâm sở hữu độc lập dữ liệu học tập/quản lý, tài khoản và vòng đời dữ
   liệu; cùng email/số điện thoại không tạo liên kết người dùng xuyên trung tâm.
2. API/worker/PostgreSQL/Redis dùng chung; mỗi trung tâm và khu công cộng có
   database, quyền kết nối, vùng file riêng. Sự cố hạ tầng chung vẫn có thể
   ảnh hưởng nhiều trung tâm; không cam kết cách ly sự cố cấp cụm.
3. Control plane chỉ giữ metadata vận hành. Ngân hàng hệ thống chứa câu hỏi,
   đề mẫu, học liệu, chương trình và metadata phân phối cần thiết; không là
   kho học sinh, bài làm, điểm, học phí hoặc danh bạ liên kết tài khoản.
4. Tài nguyên mặc định riêng; quản trị trung tâm gửi và hệ thống duyệt. Dùng
   nguyên trạng bằng tham chiếu phiên bản cố định, tạo bản riêng khi muốn sửa.
5. Trung tâm tạo được đề riêng từ câu chung và giao được đề chung; đợt giao,
   snapshot, học sinh, câu trả lời, chấm và kết quả thuộc trung tâm.
6. Hệ thống tự chụp nội dung phục vụ thi/chấm. Nguồn mới không sửa ngược đợt
   giao cũ; nguồn bị rút ngừng tiếp nhận mới và cảnh báo, giữ quyền dùng/lịch
   sử đã có. Không buộc người dùng tự copy hoặc tạo bản riêng cho mỗi học sinh.
7. Quản trị nền tảng không có quyền nghiệp vụ ngầm trong trung tâm; quyền
   hỗ trợ phải do trung tâm cấp, có phạm vi, hết hạn/thu hồi và audit.
8. Giữ chức năng học tập công cộng bằng một miền dữ liệu riêng. Không có yêu
   cầu giữ dữ liệu hiện tại; làm mô hình đích sạch, không xây di trú/tương
   thích legacy. Điều này không yêu cầu viết lại các phần nghiệp vụ đang đáp ứng.
9. Ưu tiên vận hành gọn và kiểm chứng từ API/CLI/queue thật. Chưa có mục tiêu
   tải hoặc SLA định lượng; cấu hình tài nguyên phải dựa trên đo tải.

## Nghiệm thu

- [ ] AC01 — Dựng mới A, B và khu công cộng tạo được kho, role và vùng file
      riêng; role A bị từ chối kết nối/đọc/ghi kho B.
- [ ] AC02 — Cùng email ở A/B là hai tài khoản; đổi mật khẩu/đình chỉ/xoá
      tài khoản A không ảnh hưởng đăng nhập, phiên hoặc hồ sơ tại B.
- [ ] AC03 — Token/cookie của A và request/job thiếu hoặc giả mạo phạm vi bị
      từ chối ở B; không đọc/ghi thành công vào kho chung hoặc kho khác qua fallback.
- [ ] AC04 — Control plane không có directory liên kết tài khoản người học/
      giáo viên xuyên trung tâm; registry và thao tác vận hành vẫn hoạt động.
- [ ] AC05 — Học tập ở khu công cộng vẫn hoạt động với dữ liệu riêng; dữ liệu
      lớp/học viên/bài làm/điểm của khu này không nằm trong ngân hàng hệ thống.
- [ ] AC06 — Hai trung tâm lưu file cùng nội dung/hash; xoá và chạy cleanup
      tại A không làm mất file hoặc quyền tải hợp lệ của B/khu công cộng.
- [ ] AC07 — Job/retry, cache, tìm kiếm, URL có ký và realtime không trả hoặc
      sửa dữ liệu của B khi thực hiện với ngữ cảnh A, kể cả trùng định danh nội bộ.
- [ ] AC08 — Tài nguyên A tạo không xuất hiện ở B/ngân hàng chung; giáo viên
      không được bỏ qua quyền gửi của quản trị trung tâm hoặc quyền duyệt hệ thống.
- [ ] AC09 — Quản trị A gửi và hệ thống duyệt được câu hỏi, đề mẫu, học liệu,
      chương trình; bản bị từ chối chưa được khám phá/dùng chung.
- [ ] AC10 — Tài nguyên công bố có phiên bản bất biến, thông tin nguồn và tệp
      cần thiết; xoá tài nguyên/file riêng ở nơi gửi không làm hỏng bản công bố.
- [ ] AC11 — A tạo đề riêng kết hợp câu chung và câu riêng mà không thao tác
      Copy/Import và không bắt tạo câu chung có thể biên tập trong ngân hàng A.
- [ ] AC12 — A và B giao cùng một phiên bản đề chung với lớp/lịch/cấu hình
      riêng; lượt làm, câu trả lời, chấm, nhận xét và điểm chỉ tồn tại đúng kho.
- [ ] AC13 — Chấm được câu tự động và câu cần chấm tay; học sinh/phụ huynh chỉ
      xem điểm đã công bố và không nhận đáp án/nhận xét vượt cấu hình xem lại.
- [ ] AC14 — Tạo bản riêng rồi sửa ở A không thay đổi nguồn chung, đề của B,
      hoặc nội dung/đáp án của đợt giao đã sẵn sàng.
- [ ] AC15 — Nguồn có phiên bản mới tạo được thông báo; đề và điểm của đợt
      giao cũ không đổi, chỉ lần sử dụng mới được chủ động chọn phiên bản mới.
- [ ] AC16 — Rút nguồn chặn khám phá/tiếp nhận mới, kể cả API dùng định danh
      trực tiếp; trung tâm đã tiếp nhận được cảnh báo và tiếp tục dùng phiên bản
      đã ghim, bản riêng và lịch sử. Trung tâm chưa tiếp nhận không được dùng mới.
- [ ] AC17 — Sau khi đợt giao sẵn sàng, làm bài, chấm và xem lịch sử vẫn
      thành công khi ngân hàng không truy cập được; nội dung, đáp án và quy tắc
      chấm khớp phiên bản đã chụp, không cần nguồn sống để tính kết quả.
- [ ] AC18 — Nguồn/gói hỏng, thiếu quyền, thiếu phiên bản hoặc lưu snapshot
      thất bại không tạo đợt giao sẵn sàng thiếu dữ liệu; thử lại thao tác không
      tạo bản trùng hoặc gán dữ liệu sang trung tâm khác.
- [ ] AC19 — Xuất/backup A có manifest/toàn vẹn và đủ database, dữ liệu thi,
      lịch sử chấm cùng file; không chứa dữ liệu riêng của B/khu công cộng.
- [ ] AC20 — Restore bản backup A vào môi trường cô lập tái hiện được nội dung
      đã thi, chấm, điểm và file khi nguồn chung đã đổi/rút hoặc không truy cập
      được; không thay đổi kho B hay tự liên kết tài khoản giữa các trung tâm.
- [ ] AC21 — Xoá A không làm mất dữ liệu/file/kết quả ở B, khu công cộng,
      bản công bố trong ngân hàng hoặc các bản dùng độc lập của trung tâm khác.
- [ ] AC22 — Quản trị nền tảng không có grant bị từ chối đọc hồ sơ, bài làm,
      điểm và nội dung riêng của trung tâm; cấp grant chỉ mở đúng trung tâm,
      người nhận và thao tác được cấp.
- [ ] AC23 — Grant hết hạn/thu hồi chặn request hỗ trợ tiếp theo dù phiên còn
      hiệu lực; trung tâm xem được audit cấp, dùng, thu hồi và kết quả truy cập.
- [ ] AC24 — Tương tác giao diện tạo đề từ câu chung và giao đề chung hoàn
      thành không qua bước Copy bắt buộc; hành động tạo bản riêng hiển thị khi sửa.
- [ ] AC25 — Cài mới và seed thể hiện duy nhất mô hình trung tâm kho riêng;
      không còn phụ thuộc nhánh shared, thư mục user toàn cục hoặc bank chung cũ.
- [ ] AC26 — Có số liệu pool/kết nối/tải worker và ngân sách toàn cụm cho cấu
      hình kiểm chứng; nêu rõ điều kiện đo, không suy ra SLA từ một lần chạy.
- [ ] AC27 — Hợp đồng, tài liệu nghiệp vụ, test các tầng và mã chạy cùng phản
      ánh mô hình đích; lint, typecheck, build, test cần thiết và CI trên đúng
      head/cây tích hợp đạt, ghi lệnh/kết quả/log thật trong từng PR triển khai.

## Phụ thuộc và thứ tự

Đây là đặc tả tổng thể để phân rã ở bước lập ticket, không phải yêu cầu dồn
mọi miền vào một PR. Trước khi thi công, xác định các đơn vị tính năng mạch
lạc và phụ thuộc; nếu tạo issue con phải liên kết bằng sub-issues native của
GitHub ngay khi tạo. Mỗi issue thi công có một branch/worktree và đúng một
PR, với nghiệm thu tự chứa được mang sang từ đặc tả này.

Issue đặc tả là issue cha khi được phân rã. Issue cha chỉ đóng khi mọi issue
con hoàn tất; PR cuối cùng ghi từ khoá đóng cả issue con cuối và issue cha.

Ưu tiên nền kho riêng/tài khoản/control plane và file/job trước, sau đó vòng
đời sao lưu/khôi phục, nguồn tài nguyên chung, tham chiếu/giao đề/chấm, quyền
hỗ trợ và kiểm chứng tổng thể. Mỗi ticket cần đi xuyên các tầng liên quan
đến hành vi mà nó giao, không tách schema/API/test của cùng hành vi thành
các PR rời nhau. Hỗ trợ và các phần độc lập chỉ triển khai sau khi ranh giới
định tuyến/quyền đã sẵn sàng.

Các quyết định trên đã đủ cho bước lập ticket. Những con số tải, thời hạn
vận hành cụ thể và cấu hình dung lượng chưa được lựa chọn; đo và ghi chúng
trong ticket vận hành tương ứng trước khi dùng làm ngưỡng nghiệm thu.

Đặc tả này không tuyên bố đã triển khai hoặc đã chạy các kịch bản nghiệm thu.
Chưa có thao tác xoá dữ liệu, đổi schema chạy thật hoặc triển khai production
trong bước viết đặc tả.
