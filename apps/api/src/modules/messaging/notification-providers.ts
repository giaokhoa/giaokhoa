
export const MESSAGE_CHANNELS = ['popup', 'email', 'push'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];
export type LoginState = 'loggedin' | 'loggedoff';

export type MessageProviderGroup = 'learning' | 'people' | 'system';

export type EmailFrequency = 'immediate' | 'daily' | 'off';

export type ExternalContentPolicy = 'minimized' | 'original-ok';

export type NotificationAudience = 'student' | 'staff' | 'guardian' | 'admin' | 'all';

export interface MessageProviderDefinition {
  name: string;
  component: string;
  channels: MessageChannel[];
  group: MessageProviderGroup;
  label: { vi: string; en: string };
  description: { vi: string; en: string };
  audience: NotificationAudience[];
  mandatoryInApp?: boolean;
  externalPolicy: ExternalContentPolicy;
  externalPolicyReason?: string;
}

export const MESSAGE_PROVIDERS: MessageProviderDefinition[] = [
  {
    name: 'grade_updated', component: 'core_grades', channels: ['popup', 'email'], group: 'learning', audience: ['student'], externalPolicy: 'original-ok', externalPolicyReason: 'Mẫu nội dung cấm điểm số ở mọi kênh; chỉ nêu tên khoá + tên mục điểm.',
    label: { vi: 'Điểm số thay đổi', en: 'Grade updated' },
    description: { vi: 'Khi một mục điểm của bạn được chấm hoặc cập nhật.', en: 'When one of your grade items is graded or updated.' },
  },
  {
    name: 'course_completed', component: 'core_completion', channels: ['popup'], group: 'learning', audience: ['student'], externalPolicy: 'minimized', externalPolicyReason: 'Không có kênh ngoài nên khai báo không tác động hành vi; giữ mặc định an toàn.',
    label: { vi: 'Hoàn thành khoá học', en: 'Course completed' },
    description: { vi: 'Khi bạn hoàn thành một khoá học.', en: 'When you complete a course.' },
  },
  {
    name: 'enrol_expiry_warning', component: 'core_enrol', channels: ['popup', 'email'], group: 'learning', mandatoryInApp: true, audience: ['student'], externalPolicy: 'original-ok', externalPolicyReason: 'Chỉ nêu tên khoá + ngày hết hạn ghi danh của chính người nhận.',
    label: { vi: 'Sắp hết hạn ghi danh', en: 'Enrolment expiring soon' },
    description: { vi: 'Khi thời hạn ghi danh khoá học của bạn sắp hết.', en: 'When your course enrolment is about to expire.' },
  },
  {
    name: 'enrol_welcome', component: 'core_enrol', channels: ['popup', 'email'], group: 'learning', audience: ['student'], externalPolicy: 'original-ok', externalPolicyReason: 'Văn bản chào mừng do giáo viên soạn cho chính khoá của mình gửi học viên ghi danh — tác giả chịu trách nhiệm về nội dung.',
    label: { vi: 'Chào mừng ghi danh', en: 'Enrolment welcome' },
    description: { vi: 'Khi bạn được ghi danh vào một khoá học mới.', en: 'When you are enrolled in a new course.' },
  },
  {
    name: 'activity_due_soon', component: 'core_course', channels: ['popup', 'email'], group: 'learning', audience: ['student'], externalPolicy: 'original-ok', externalPolicyReason: 'Chỉ nêu tên hoạt động + tên khoá + mốc hạn của chính người nhận.',
    label: { vi: 'Hoạt động sắp đến hạn', en: 'Activity due soon' },
    description: { vi: 'Nhắc trước 24 giờ khi bài tập hoặc bài kiểm tra sắp đến hạn nộp.', en: 'A reminder 24 hours before an assignment or quiz is due.' },
  },
  {
    name: 'assignment_assigned', component: 'mod_assign', channels: ['popup', 'email'], group: 'learning', audience: ['student'], externalPolicy: 'original-ok', externalPolicyReason: 'Chỉ nêu tên bài tập + tên khoá — dữ kiện học sinh tự thấy trong khoá.',
    label: { vi: 'Bài tập mới', en: 'New assignment' },
    description: { vi: 'Khi giáo viên giao một bài tập mới trong khoá của bạn.', en: 'When a teacher assigns new work in your course.' },
  },
  {
    name: 'assignment_submitted', component: 'mod_assign', channels: ['popup', 'email'], group: 'learning', audience: ['student', 'staff'], externalPolicy: 'original-ok', externalPolicyReason: 'Biên nhận tên hoạt động cho học sinh; bản giáo viên thêm số lượng bài chờ chấm — dữ kiện công việc của chính người nhận.',
    label: { vi: 'Bài nộp', en: 'Submission' },
    description: { vi: 'Xác nhận khi bạn nộp bài; giáo viên nhận bản gộp số bài chờ chấm theo bài tập.', en: 'Your submission receipt; teachers get the grouped pending count per assignment.' },
  },
  {
    name: 'assignment_returned', component: 'mod_assign', channels: ['popup', 'email'], group: 'learning', audience: ['student'], externalPolicy: 'original-ok', externalPolicyReason: 'Chỉ nêu tên bài tập + tên khoá; điểm/mức đã bị loại ở tầng nội dung dù payload có.',
    label: { vi: 'Bài đã được trả', en: 'Assignment returned' },
    description: { vi: 'Khi giáo viên trả bài kèm lời phê cho bạn.', en: 'When a teacher returns your work with feedback.' },
  },
  {
    name: 'quiz_available', component: 'mod_quiz', channels: ['popup', 'email'], group: 'learning', audience: ['student'], externalPolicy: 'original-ok', externalPolicyReason: 'Chỉ nêu tên bài kiểm tra + tên khoá — dữ kiện học sinh tự thấy trong khoá.',
    label: { vi: 'Bài kiểm tra mới', en: 'New quiz' },
    description: { vi: 'Khi một bài kiểm tra mới được mở trong khoá của bạn.', en: 'When a new quiz opens in your course.' },
  },
  {
    name: 'quiz_attempt_finished', component: 'mod_quiz', channels: ['popup', 'email'], group: 'learning', audience: ['staff'], externalPolicy: 'original-ok', externalPolicyReason: 'Chỉ nêu số lượt làm chờ chấm tay theo bài kiểm tra — dữ kiện công việc của giáo viên nhận.',
    label: { vi: 'Lượt làm bài cần chấm', en: 'Attempt needs grading' },
    description: { vi: 'Khi học sinh kết thúc lượt làm bài có câu cần chấm tay.', en: 'When a student finishes an attempt that needs manual grading.' },
  },
  {
    name: 'guardian_digest', component: 'core_guardian', channels: ['popup', 'email'], group: 'learning', audience: ['guardian'], externalPolicy: 'minimized', externalPolicyReason: 'Nội dung trong app là dữ kiện học tập của trẻ gửi cho phụ huynh; nơi gọi bắt buộc truyền bản tối thiểu hoá.',
    label: { vi: 'Tổng hợp cho phụ huynh', en: 'Guardian digest' },
    description: { vi: 'Bản tổng hợp tiến độ học tập gửi cho phụ huynh theo lịch.', en: 'The scheduled learning-progress digest for guardians.' },
  },
  {
    name: 'guardian_overdue_alert', component: 'core_guardian', channels: ['popup', 'email'], group: 'learning', audience: ['guardian'], externalPolicy: 'minimized', externalPolicyReason: 'Nội dung trong app chứa tên học viên; nơi gọi bắt buộc truyền bản tối thiểu hoá.',
    label: { vi: 'Cảnh báo quá hạn cho phụ huynh', en: 'Guardian overdue alert' },
    description: { vi: 'Khi con bạn có hoạt động quá hạn từ 7 ngày trở lên.', en: 'When your child has an activity overdue by 7 days or more.' },
  },
  {
    name: 'badge_awarded', component: 'core_badges', channels: ['popup', 'email', 'push'], group: 'people', audience: ['all'], externalPolicy: 'original-ok', externalPolicyReason: 'Tên huy hiệu + đơn vị cấp là thành tích của chính người nhận; không kèm điểm số hay tiêu chí chi tiết.',
    label: { vi: 'Huy hiệu mới', en: 'New badge' },
    description: { vi: 'Khi bạn được trao một huy hiệu.', en: 'When you are awarded a badge.' },
  },
  {
    name: 'competency_review_requested', component: 'core_competency', channels: ['popup', 'email'], group: 'people', audience: ['staff'], externalPolicy: 'minimized', externalPolicyReason: 'Thân trong app chứa UUID nội bộ (userId/planId); nơi gọi bắt buộc truyền bản tối thiểu hoá không chứa định danh nội bộ.',
    label: { vi: 'Yêu cầu duyệt năng lực', en: 'Competency review requested' },
    description: { vi: 'Khi có người yêu cầu bạn duyệt bằng chứng năng lực.', en: 'When someone asks you to review competency evidence.' },
  },
  {
    name: 'contact_request', component: 'core_message', channels: ['popup', 'email'], group: 'people', audience: ['all'], externalPolicy: 'original-ok', externalPolicyReason: 'Văn bản hệ thống tĩnh hoàn toàn, không chứa dữ kiện của người dùng.',
    label: { vi: 'Yêu cầu kết bạn', en: 'Contact request' },
    description: { vi: 'Khi có người gửi yêu cầu kết bạn cho bạn.', en: 'When someone sends you a contact request.' },
  },
  {
    name: 'conversation_reported', component: 'core_message', channels: ['popup', 'email'], group: 'people', audience: ['staff', 'admin'], externalPolicy: 'original-ok', externalPolicyReason: 'Văn bản hệ thống tĩnh hoàn toàn, không chứa nội dung hội thoại bị báo cáo.',
    label: { vi: 'Hội thoại bị báo cáo', en: 'Conversation reported' },
    description: { vi: 'Khi một hội thoại trong khoá bạn phụ trách bị báo cáo.', en: 'When a conversation in a course you teach is reported.' },
  },
  {
    name: 'message_new', component: 'core_message', channels: ['popup', 'email'], group: 'people', audience: ['all'], externalPolicy: 'original-ok', externalPolicyReason: 'Chỉ nêu tên người gửi; nội dung tin nhắn không bao giờ nằm trong thông báo.',
    label: { vi: 'Tin nhắn mới', en: 'New message' },
    description: { vi: 'Khi bạn nhận được tin nhắn mới (nội dung tin không nằm trong thông báo).', en: 'When you receive a new message (the message text is never included).' },
  },
  {
    name: 'calendar_reminder', component: 'core_calendar', channels: ['popup', 'email'], group: 'system', audience: ['all'], externalPolicy: 'original-ok', externalPolicyReason: 'Mẫu nhắc lịch tĩnh của chính người nhận; đường phát thật ở phía worker không qua notify() — khai báo ở đây để luật đồng nhất.',
    label: { vi: 'Nhắc sự kiện lịch', en: 'Calendar reminder' },
    description: { vi: 'Nhắc trước các sự kiện lịch bạn đã đặt.', en: 'Reminders for calendar events you created.' },
  },
  {
    name: 'report_scheduled', component: 'core_reportbuilder', channels: ['popup', 'email'], group: 'system', audience: ['staff', 'admin'], externalPolicy: 'original-ok', externalPolicyReason: 'Dữ kiện vận hành (mã báo cáo, số dòng) gửi chính chủ lịch báo cáo — không phải dữ kiện học tập của học viên.',
    label: { vi: 'Báo cáo định kỳ', en: 'Scheduled report' },
    description: { vi: 'Khi báo cáo định kỳ của bạn đã chạy xong.', en: 'When one of your scheduled reports has finished.' },
  },
  {
    name: 'admin_announcement', component: 'core_admin', channels: ['popup', 'email'], group: 'system', mandatoryInApp: true, audience: ['all'], externalPolicy: 'minimized', externalPolicyReason: 'Nội dung là văn bản tự do do quản trị viên soạn, không qua mẫu — sendSystemNotification áp cứng tối thiểu hoá cho mọi provider của đường gửi hệ thống.',
    label: { vi: 'Thông báo quản trị & an toàn', en: 'Administrative & safety notices' },
    description: { vi: 'Thông báo chính thức từ quản trị hệ thống, gồm cả cảnh báo an toàn tài khoản.', en: 'Official notices from system administrators, including account-safety alerts.' },
  },
];

export function providerByName(name: string): MessageProviderDefinition | undefined {
  return MESSAGE_PROVIDERS.find((p) => p.name === name);
}

export function externalPolicyOf(provider: MessageProviderDefinition): ExternalContentPolicy {
  return provider.externalPolicy ?? 'minimized';
}

export function providerVisibleToAudiences(
  provider: MessageProviderDefinition,
  audiences: ReadonlySet<NotificationAudience>,
): boolean {
  return provider.audience.some((a) => a === 'all' || audiences.has(a));
}

export function isTeacherOnlyProvider(provider: MessageProviderDefinition): boolean {
  return provider.audience.includes('staff')
    && provider.audience.every((a) => a === 'staff' || a === 'admin');
}

export function eventTypesOfGroup(group: MessageProviderGroup): string[] {
  return MESSAGE_PROVIDERS.filter((p) => p.group === group).map((p) => p.name);
}

export function groupOfEventType(eventType: string): MessageProviderGroup {
  return providerByName(eventType)?.group ?? 'system';
}

export function preferenceName(provider: string, channel: MessageChannel, state: LoginState): string {
  return `message_provider_${provider}_${channel}_${state}`;
}

export function preferenceNameV2(provider: string, kind: 'popup' | 'email'): string {
  return `message_provider_${provider}_${kind}_v2`;
}

export function coursePreferenceName(courseId: string): string {
  return `notif.course.${courseId}`;
}

export type NotificationCourseOverrideMode = 'all' | 'mute';

export interface NotificationCourseOverrideView {
  courseId: string;
  courseName: string;
  mode: NotificationCourseOverrideMode;
}

const COURSE_MUTE_EXEMPT_PROVIDERS = new Set(['grade_updated', 'enrol_expiry_warning']);

export function isExemptFromCourseMute(provider: MessageProviderDefinition): boolean {
  return provider.mandatoryInApp === true || COURSE_MUTE_EXEMPT_PROVIDERS.has(provider.name);
}

export const EMAIL_CHANNEL_AVAILABLE = true;

export function defaultEmailFrequency(group: MessageProviderGroup): EmailFrequency {
  return group === 'learning' ? 'daily' : 'immediate';
}

export interface NotificationPreferenceView {
  provider: string;
  component: string;
  group: MessageProviderGroup;
  label: { vi: string; en: string };
  description: { vi: string; en: string };
  teacherOnly: boolean;
  mandatoryInApp: boolean;
  popupEnabled: boolean;
  emailFrequency: EmailFrequency | null;
  emailAvailable: boolean;
  siteEnabled: boolean;
}

export interface NotifyResult {
  provider: string;
  userId: string;
  notificationId: string | null;
  channels: Record<string, string>;
  skipped?: 'suspended' | 'unknown-provider' | 'course-mute' | 'admin-disabled';
}

export const NOTIFICATION_POLICY_COMPONENT = 'notifications';

export function notificationPolicySettingName(providerName: string): string {
  return `provider_${providerName}_enabled`;
}

export const MANDATORY_NOTIFICATION_PROVIDERS: readonly string[] =
  MESSAGE_PROVIDERS.filter((p) => p.mandatoryInApp === true).map((p) => p.name);
