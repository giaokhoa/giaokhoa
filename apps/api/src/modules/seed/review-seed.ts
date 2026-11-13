import { VersioningType, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { ProblemDetailsFilter } from '../../common/problem-details.filter';
import { BetterAuthService } from '../auth/better-auth/better-auth.service';
import { CredentialBridgeService } from '../auth/better-auth/credential-bridge.service';
import { ProgramDumpService } from '../curriculum/program-dump.service';
import { tenantAls } from '../tenants/tenant-als';

/**
 * Seed dữ liệu mẫu cho buổi review (chạy bằng `pnpm seed` ở thư mục gốc).
 *
 * Script khởi động API trên một cổng tạm, đăng nhập bằng tài khoản admin
 * (gieo lúc bootstrap từ biến môi trường ADMIN_*) rồi tạo dữ liệu mẫu qua
 * chính HTTP API công khai — cùng đường mà giao diện dùng. Mọi bước đều find-or-create nên chạy lại nhiều lần không tạo trùng (idempotent).
 *
 * Dữ liệu tạo ra: teacher1, student1, student2, parent1 (phụ huynh của student1, kèm một liên kết giám hộ đang hiệu lực parent1 → student1 để đăng nhập nghiệm thu được bề mặt phụ huynh); một khoá học mẫu có sections + module, ghi danh, điểm mẫu, một huy hiệu đã cấp cho student1 và một sự kiện lịch của khoá học. Mật khẩu xem tại README, mục Review — CHỈ dùng cho môi trường dev/review.
 *
 * Riêng chương trình GDPT 2018 không đi qua HTTP: seed RESTORE dump đông cứng trong repo qua ProgramDumpService (không chạy importer) — xem khối "[seed] program dump ..." trong main().
 */
const ADMIN = { username: process.env['ADMIN_USERNAME'] ?? 'admin', password: process.env['ADMIN_PASSWORD'] ?? 'Admin123!' };
const TEACHER_PASSWORD = ['Teacher', '123', '!'].join('');
const STUDENT_PASSWORD = ['Student', '123', '!'].join('');
const GUARDIAN_PASSWORD = ['Parent', '123', '!'].join('');
const TEACHER = { username: 'teacher1', password: TEACHER_PASSWORD, firstName: 'Lan Anh', lastName: 'Nguyễn', email: 'teacher1@example.com' };
const STUDENTS = [
  { username: 'student1', password: STUDENT_PASSWORD, firstName: 'Minh Quân', lastName: 'Trần', email: 'student1@example.com' },
  { username: 'student2', password: STUDENT_PASSWORD, firstName: 'Thu Hằng', lastName: 'Phạm', email: 'student2@example.com' },
];
/** Phụ huynh mẫu của student1 (họ Trần như student1): tài khoản để nghiệm thu vai phụ huynh; liên kết giám hộ tới student1 được tạo ở bước riêng sau khi cả hai đã là thành viên tenant. */
const GUARDIAN = { username: 'parent1', password: GUARDIAN_PASSWORD, firstName: 'Văn Đức', lastName: 'Trần', email: 'parent1@example.com' };
const COURSE_SHORTNAME = 'DEMO101';
/** Một ngày tính bằng mili-giây — hạn nộp bài mẫu (3 ngày) và sự kiện lịch mẫu (ngày mai) dùng chung, không rải số magic inline. */
const DAY_MS = 24 * 3600_000;

/**
 * Gọi HTTP tới API công khai trong lúc seed — `T` là hình dạng body kỳ vọng, để sai hình thì lỗi kiểu ngay tại nơi gọi thay vì cast `as` ở từng nơi.
 */
type SeedCall = <T>(method: string, path: string, token?: string, body?: unknown) => Promise<{ status: number; body: T }>;

/** Bắt buộc một lời gọi seed thành công (2xx) — ngược lại ném lỗi kèm trạng thái + body để biết bước nào gãy. */
function must<T>(res: { status: number; body: T }, what: string): T {
  if (res.status < 200 || res.status >= 300) throw new Error(`${what} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/**
 * Trạng thái chạy của seed, dùng chung giữa các giai đoạn: client HTTP + app đã khởi động và các định danh đã tạo ở giai đoạn trước (token admin sau khi chuyển tenant, id người dùng/khoá/lớp, token giáo viên). Giai đoạn nào điền trường nào xem TSDoc của chính giai đoạn đó.
 */
interface SeedContext {
  app: INestApplication;
  call: SeedCall;
  adminToken: string;
  teacherId: string;
  studentIds: string[];
  guardianId: string;
  classId: string;
  courseId: string;
  courseContent: { contextId: string; sections: { id: string; name: string | null; modules: { id: string; name: string }[] }[] };
  teacherToken: string;
  week1: string;
  week2: string;
}

/**
 * Khởi động API trên một cổng tạm (cùng cấu hình bootstrap với main.ts: prefix + versioning + filter lỗi) và trả client HTTP trỏ vào nó.
 */
async function startSeedApp(): Promise<{ app: INestApplication; call: SeedCall }> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  // Cùng cấu hình bootstrap với main.ts (prefix + versioning + filter lỗi).
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.listen(0);
  const { port } = app.getHttpServer().address() as { port: number };
  const base = `http://127.0.0.1:${port}/api/v1`;
  const call: SeedCall = async (method, path, token, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
  };
  return { app, call };
}



/** Tài khoản mẫu: đăng nhập admin, tạo teacher1/student1/student2/parent1 (find-or-create), đồng bộ credential Better Auth cho tài khoản đã tồn tại từ lần seed trước. */
async function seedDemoUsers(ctx: SeedContext): Promise<void> {
  const login = must(await call('POST', '/auth/token', undefined, ADMIN), 'admin login');
  ctx.adminToken = (login as { accessToken: string }).accessToken;
  console.log('[seed] admin login ok');

  const findUser = async (username: string) => {
    const res = must(await call('GET', `/users?search=${username}&pageSize=50`, ctx.adminToken), 'list users') as { users: { id: string; username: string }[] };
    const items = res.users ?? [];
    return items.find((u) => u.username === username);
  };
  const ensureUser = async (u: typeof TEACHER) => {
    const existing = await findUser(u.username);
    if (existing) { console.log(`[seed] user ${u.username} exists (#${existing.id})`); return existing.id; }
    const created = must(await call('POST', '/users', ctx.adminToken, u), `create ${u.username}`) as { id: string };
    console.log(`[seed] user ${u.username} created (#${created.id})`);
    return created.id;
  };
  ctx.ctx.teacherId = await ensureUser(TEACHER);
  ctx.ctx.studentIds = [await ensureUser(STUDENTS[0]!), await ensureUser(STUDENTS[1]!)];
  ctx.ctx.guardianId = await ensureUser(GUARDIAN);

  // Chặng 2.6 (issue #7): tài khoản mẫu phải đăng nhập được qua
  // Better Auth NGAY sau seed. User tạo mới trong chính lượt seed
  // này đã được UsersService tự đồng bộ credential; khối này phủ
  // các tài khoản ĐÃ tồn tại từ lần seed trước (ensureUser bỏ qua
  // đường tạo) — sync idempotent, chạy lại vô hại. Chỉ chạy khi
  // tiến trình seed bật Better Auth (env của chính tiến trình seed);
  // tắt thì bỏ qua, seed giữ nguyên hành vi cũ.
  const baService = app.get(BetterAuthService, { strict: false });
  if (baService.enabled) {
    const bridge = app.get(CredentialBridgeService, { strict: false });
    const adminId = (await findUser(ADMIN.username))?.id;
    for (const uid of [adminId, ctx.teacherId, ...ctx.studentIds, ctx.guardianId]) {
      if (!uid) continue;
      const linked = await bridge.syncCredentialPassword(uid);
      console.log(`[seed] better-auth credential ${linked ? 'linked' : 'already in sync'} for user #${uid}`);
    }
  } else {
    console.log('[seed] better-auth disabled in seed process — credential linking skipped');
  }
}

/** Tenant trường mẫu: thêm giáo viên/học sinh/phụ huynh làm thành viên tenant truong-mac-dinh rồi chuyển phiên admin sang tenant đó — từ đây mọi dữ liệu mẫu đều thuộc tenant trường. */
async function seedSchoolTenant(ctx: SeedContext): Promise<void> {
  // TENANT-0 (#168): câu chuyện mẫu sống ở tenant trường mặc định
  // (truong-mac-dinh, bootstrap seed đã tạo). Thêm giáo viên/học sinh
  // làm thành viên tường minh rồi chuyển phiên admin sang tenant đó —
  // từ đây mọi dữ liệu mẫu (danh mục, khoá DEMO101, điểm, sự kiện) đều
  // thuộc tenant-1. Ghi danh vào khoá cũng tự đảm bảo membership qua
  // móc enrol, nhưng vai giáo viên gán ở bước sau cần membership có
  // hiệu lực ngay từ đầu phiên tenant.
  // Tra registry của platform để tìm trường mẫu: bộ chọn phiên
  // chỉ công bố tenant hiện hành, không tìm theo định danh user toàn cục.
  const registry = must(await call('GET', '/tenants', ctx.adminToken), 'list registry tenants') as { id: string; slug: string }[];
  const school = registry.find((t) => t.slug === 'truong-mac-dinh');
  if (!school) throw new Error('default school tenant (truong-mac-dinh) is not seeded');
  // Phụ huynh mẫu cũng phải là thành viên tenant: tạo liên kết giám
  // hộ trong tenant này đòi cả hai phía là thành viên đang hiệu lực
  // (assertBothMembers của GuardiansService).
  for (const uid of [ctx.teacherId, ...ctx.studentIds, ctx.guardianId]) {
    must(await call('POST', `/tenants/${school.id}/members`, ctx.adminToken, { userId: uid }), `add tenant member ${uid}`);
  }
  const switched = must(await call('POST', `/auth/switch-tenant/${school.id}`, ctx.adminToken), 'switch admin to school tenant') as { accessToken: string };
  ctx.adminToken = switched.accessToken;
  console.log('[seed] admin session switched to tenant truong-mac-dinh; demo users are members');
}

/** Khoá học mẫu: danh mục, lớp LOP-MAU-10A1, khoá DEMO101 trong lớp, section Tuần 1/Tuần 2 + module chào mừng/tài liệu. */
async function seedDemoCourse(ctx: SeedContext): Promise<void> {
  const categories = must(await call('GET', '/courses/categories', ctx.adminToken), 'list categories') as { id: string; name: string }[];
  let category = categories.find((c) => c.name === 'Danh mục mẫu');
  if (!category) {
    category = must(await call('POST', '/courses/categories', ctx.adminToken, { name: 'Danh mục mẫu' }), 'create category') as { id: string; name: string };
    console.log(`[seed] category created (#${category.id})`);
  }

  // Lớp học hạng nhất (issue #184, CLASS-0): lớp tạo TRƯỚC, DEMO101
  // nằm bên trong lớp mẫu của teacher1; học sinh vào khoá qua ROSTER
  // của lớp (cohort sync vật chất hoá ghi danh) — seed chạy đúng
  // đường sản phẩm thật để mọi lượt probe sau reset kiểm chứng luôn
  // cả ghi danh cấp lớp. Admin tạo lớp hộ (ownerId = teacher1).
  const DEMO_CLASS_CODE = 'LOP-MAU-10A1';
  const classList = must(await call('GET', '/classes', ctx.adminToken), 'list classes') as { id: string; code: string | null }[];
  let demoClass = classList.find((c) => c.code === DEMO_CLASS_CODE);
  if (!demoClass) {
    demoClass = must(await call('POST', '/classes', ctx.adminToken, {
      name: 'Lớp mẫu 10A1', code: DEMO_CLASS_CODE, schoolYear: '2025–2026', ownerId: ctx.teacherId,
      description: 'Lớp mẫu cho buổi review: chứa khoá DEMO101; học sinh vào khoá qua roster của lớp.',
    }), 'create demo class') as { id: string; code: string | null };
    console.log(`[seed] demo class "Lớp mẫu 10A1" created (#${demoClass.id}), owner teacher1`);
  }
  ctx.classId = demoClass.id;

  const courses = must(await call('GET', '/courses', ctx.adminToken), 'list courses') as { items?: { id: string; shortName: string; classId?: string | null }[] } | { id: string; shortName: string; classId?: string | null }[];
  const courseItems = Array.isArray(courses) ? courses : (courses.items ?? []);
  let course = courseItems.find((c) => c.shortName === COURSE_SHORTNAME);
  if (!course) {
    course = must(await call('POST', '/courses', ctx.adminToken, {
      fullName: 'Khoá học mẫu: Làm quen với Giáo khoa', shortName: COURSE_SHORTNAME, category: category.id, classId: ctx.classId,
      summary: 'Khoá học mẫu phục vụ buổi review: có section, module, điểm, huy hiệu và sự kiện lịch.',
    }), 'create course') as { id: string; shortName: string; classId?: string | null };
    console.log(`[seed] course created (#${course.id}) inside demo class`);
  } else if (course.classId !== ctx.classId) {
    console.log(`[seed] WARNING: course ${COURSE_SHORTNAME} exists but is not in the demo class (classId=${course.classId ?? 'null'}) — roster enrolment will not reach it; reset the DB to rebuild the demo story`);
  }
  ctx.ctx.courseId = course.id;

  ctx.courseContent = must(await call('GET', `/courses/${ctx.ctx.courseId}/content`, ctx.adminToken), 'course content') as {
    contextId: string; sections: { id: string; name: string | null; modules: { id: string; name: string }[] }[];
  };
  const ensureSection = async (name: string) => {
    const found = ctx.courseContent.sections.find((s) => s.name === name);
    if (found) return found.id;
    const created = must(await call('POST', `/courses/${ctx.courseId}/sections`, ctx.adminToken, { name }), `create section ${name}`) as { id: string };
    console.log(`[seed] section "${name}" created (#${created.id})`);
    return created.id;
  };
  ctx.ctx.week1 = await ensureSection('Tuần 1: Bắt đầu');
  ctx.ctx.week2 = await ensureSection('Tuần 2: Luyện tập');
  const allModules = ctx.courseContent.sections.flatMap((s) => s.modules.map((m) => ({ ...m, sectionId: s.id })));
  const ensureCm = async (sectionId: string, component: string, name: string) => {
    if (allModules.some((m) => m.name === name)) return;
    must(await call('POST', `/courses/${ctx.courseId}/modules`, ctx.adminToken, { sectionId, component, name }), `create cm ${name}`);
    console.log(`[seed] module "${name}" created`);
  };
  await ensureCm(ctx.week1, 'mod_page', 'Trang chào mừng');
  await ensureCm(ctx.week1, 'mod_resource', 'Tài liệu hướng dẫn học tập');
}

/** Ghi danh qua lớp: thêm học sinh vào roster lớp (cohort sync vật chất hoá ghi danh vào DEMO101) và gán role editingteacher cho teacher1 tại context khoá học. */
async function seedEnrolment(ctx: SeedContext): Promise<void> {
  // Ghi danh học sinh QUA LỚP (issue #184): thêm vào roster của lớp
  // mẫu → instance cohort của DEMO101 (tự tạo khi khoá được tạo trong
  // lớp) vật chất hoá thành ghi danh thật. Không còn instance manual
  // + ghi danh tay như trước — đây là đường ghi danh chính của sản phẩm.
  const roster = must(await call('GET', `/classes/${ctx.classId}/roster`, ctx.adminToken), 'list class roster') as { userId: string }[];
  for (const sid of ctx.studentIds) {
    if (roster.some((m) => m.userId === sid)) { console.log(`[seed] student #${sid} already in demo class roster`); continue; }
    must(await call('POST', `/classes/${ctx.classId}/roster`, ctx.adminToken, { userId: sid }), `add student ${sid} to demo class roster`);
    console.log(`[seed] student #${sid} added to demo class roster (cohort sync enrols into DEMO101)`);
  }
  // Giáo viên: gán role editingteacher tại context khoá học.
  const roles = must(await call('GET', '/access/roles', ctx.adminToken), 'list roles') as { id: string; shortName: string }[];
  const teacherRole = roles.find((r) => r.shortName === 'editingteacher');
  if (teacherRole) {
    // Từ issue #545: phản hồi liệt kê gán vai là trang
    // `{ assignments, total, page, pageSize }`, không còn là mảng trần.
    const assignments = (must(await call('GET', `/access/assignments?userId=${ctx.teacherId}&contextId=${ctx.courseContent.contextId}`, ctx.adminToken), 'list assignments') as { assignments: { roleId: string }[] }).assignments ?? [];
    if (!assignments.some((a) => a.roleId === teacherRole.id)) {
      must(await call('POST', '/access/assignments', ctx.adminToken, { userId: ctx.teacherId, roleId: teacherRole.id, contextId: ctx.courseContent.contextId }), 'assign teacher role');
      console.log('[seed] teacher1 assigned editingteacher at the course');
    } else console.log('[seed] teacher role assignment exists');
  }
}

/** Liên kết giám hộ mẫu parent1 → student1 (đang hiệu lực; đã có thì bỏ qua). */
async function seedGuardianLink(ctx: SeedContext): Promise<void> {
  // Liên kết giám hộ mẫu (gói kích hoạt phụ huynh): parent1 là phụ
  // huynh của student1. Tạo bằng chính endpoint quản lý liên kết
  // trong phiên tenant của admin (admin là quản trị site nên qua
  // cổng guardian:manage); cả parent1 và student1 đều đã là thành
  // viên tenant ở bước trên nên điều kiện thành viên của liên kết
  // được thoả. Idempotent: cặp đã có liên kết đang hiệu lực thì bỏ
  // qua (tạo trùng sẽ bị API trả 409).
  const existingLinks = must(await call('GET', `/guardian-links?guardianUserId=${ctx.guardianId}&studentUserId=${ctx.studentIds[0]}&status=active`, ctx.adminToken), 'list guardian links') as { id: string }[];
  if (existingLinks.length > 0) {
    console.log('[seed] guardian link parent1 → student1 already active');
  } else {
    const link = must(await call('POST', '/guardian-links', ctx.adminToken, {
      guardianUserId: ctx.guardianId, studentUserId: ctx.studentIds[0], relationship: 'Cha',
    }), 'create guardian link') as { id: string };
    console.log(`[seed] guardian link parent1 → student1 created (#${link.id})`);
  }
}

/** Bài tập mẫu: đăng nhập teacher1, tạo bài tập nộp tệp/ảnh ở Tuần 2 kèm bảng tiêu chí (chỉ dựng rubric khi bài chưa có). */
async function seedSampleAssignment(ctx: SeedContext): Promise<void> {
  // Bài tập mẫu mod_assign (ĐX-1, issue #179): một hoạt động Bài tập
  // nộp tệp/ảnh ở Tuần 2 kèm bảng tiêu chí, để nghiệm thu trình duyệt
  // đi trọn vòng nộp → chấm → trả. Tạo bằng chính tài khoản teacher1
  // (đã có editingteacher tại khoá) — đúng đường giáo viên thật dùng.
  // Idempotent: đã có bài cùng tên thì giữ nguyên, rubric chỉ dựng khi
  // bài chưa có bảng tiêu chí.
  const teacherLogin = must(await call('POST', '/auth/token', undefined, { username: TEACHER.username, password: TEACHER_PASSWORD }), 'teacher login');
  ctx.ctx.teacherToken = (teacherLogin as { accessToken: string }).accessToken;
  const SAMPLE_ASSIGNMENT_NAME = 'Bài tập mẫu: Chụp ảnh bài làm và nộp';
  const existingAssignments = must(await call('GET', `/courses/${ctx.courseId}/assignments`, ctx.ctx.teacherToken), 'list assignments') as { id: string; name: string }[];
  let sampleAssignment = existingAssignments.find((a) => a.name === SAMPLE_ASSIGNMENT_NAME);
  if (!sampleAssignment) {
    const due = new Date(Date.now() + 3 * DAY_MS);
    sampleAssignment = must(await call('POST', `/courses/${ctx.courseId}/assignments`, ctx.ctx.teacherToken, {
      sectionId: ctx.week2,
      name: SAMPLE_ASSIGNMENT_NAME,
      intro: 'Chụp ảnh bài làm trên giấy (hoặc nộp tệp bất kỳ) rồi bấm Chốt nộp bài. Nộp sau hạn vẫn được nhận nhưng bị đánh dấu trễ.',
      dueDate: due.toISOString(),
      maxFiles: 5,
      acceptedFileTypes: null,
      grade: 10,
      resultMode: 'score_feedback',
    }), 'create sample assignment') as { id: string; name: string };
    console.log(`[seed] sample assignment created (#${sampleAssignment.id})`);
  } else console.log('[seed] sample assignment exists');
  const rubricRes = await call('GET', `/assignments/${sampleAssignment.id}/rubric`, ctx.ctx.teacherToken);
  const existingRubric = (rubricRes.body as unknown as { rubric: unknown } | undefined)?.rubric;
  if (!existingRubric) {
    must(await call('PUT', `/assignments/${sampleAssignment.id}/rubric`, ctx.ctx.teacherToken, {
      title: 'Tiêu chí chấm bài tập mẫu',
      criteria: [
        {
          name: 'Đúng nội dung',
          descriptionForStudent: 'Bài làm đúng yêu cầu, đủ các ý chính.',
          mode: 'levels',
          levels: [
            { label: 'Tốt', score: 6 },
            { label: 'Khá', score: 4 },
            { label: 'Cần cố gắng', score: 2 },
          ],
        },
        {
          name: 'Trình bày',
          descriptionForStudent: 'Ảnh chụp rõ nét, trình bày sạch sẽ, dễ đọc.',
          mode: 'score',
          maxScore: 4,
        },
      ],
    }), 'create sample rubric');
    console.log('[seed] sample assignment rubric created');
  } else console.log('[seed] sample assignment rubric exists');
}

/** Bài kiểm tra mẫu: soạn 2 câu trong bank cá nhân của teacher1 (multichoice + truefalse TF-A) → tạo đề trong bank đề cá nhân → ready → ghim vào Tuần 2. */
async function seedSampleExam(ctx: SeedContext): Promise<void> {
  // Bài kiểm tra mẫu (gộp Đề #226): dựng bằng ĐÚNG đường người dùng
  // qua tài khoản teacher1 — soạn câu trong bank câu hỏi cá nhân →
  // tạo ĐỀ trong bank đề cá nhân → ready → GHIM vào Tuần 2 của khoá
  // (exam-pins tự tạo course module mod_quiz + grade item). Idempotent:
  // khoá đã có lần ghim mang tên này thì giữ nguyên.
  const SAMPLE_EXAM_NAME = 'Bài kiểm tra thử';
  const existingPins = must(await call('GET', `/courses/${ctx.courseId}/exam-pins`, ctx.ctx.teacherToken), 'list pins') as { id: string; name: string }[];
  if (existingPins.some((pin) => pin.name === SAMPLE_EXAM_NAME)) {
    console.log('[seed] sample exam pin exists');
  } else {
    const qBanks = must(await call('GET', '/question-banks?kind=question', ctx.ctx.teacherToken), 'list question banks') as { scope: string; defaultCategoryId: string | null }[];
    const myQBank = qBanks.find((b) => b.scope === 'personal');
    if (!myQBank?.defaultCategoryId) throw new Error('teacher1 personal question bank not found');
    const q1 = must(await call('POST', '/questions', ctx.ctx.teacherToken, {
      categoryId: myQBank.defaultCategoryId, qtype: 'multichoice',
      questionText: '2 + 3 bằng mấy?',
      answers: [
        { text: '5', correct: true },
        { text: '6', correct: false },
        { text: '4', correct: false },
        { text: '7', correct: false },
      ],
    }), 'create sample question 1') as { question: { id: string } };
    // Câu đúng/sai mẫu theo mô hình TF-A (P5): MỘT câu chùm — thân
    // chung + 4 mệnh đề trong questionText, đáp án từng mệnh đề qua
    // solution.answers (không còn hai dòng answers Đúng/Sai).
    const tfStatementIds = ['seed-tf-s1', 'seed-tf-s2', 'seed-tf-s3', 'seed-tf-s4'];
    const tfStatements: [string, boolean][] = [
      ['Trái Đất quay quanh Mặt Trời.', true],
      ['Mặt Trăng là một ngôi sao.', false],
      ['Nước sôi ở 100°C trong điều kiện áp suất khí quyển tiêu chuẩn.', true],
      ['Mùa hè ở bán cầu Nam bắt đầu vào tháng 6.', false],
    ];
    const q2 = must(await call('POST', '/questions', ctx.ctx.teacherToken, {
      categoryId: myQBank.defaultCategoryId, qtype: 'truefalse',
      questionText: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Xét các mệnh đề sau:' }] },
          {
            type: 'statementList',
            content: tfStatements.map(([text], i) => ({
              type: 'statement',
              attrs: { id: tfStatementIds[i]! },
              content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
            })),
          },
        ],
      },
      solution: {
        answers: tfStatements.map(([, value], i) => ({ statementId: tfStatementIds[i]!, value })),
      },
    }), 'create sample question 2') as { question: { id: string } };
    const eBanks = must(await call('GET', '/question-banks?kind=exam', ctx.ctx.teacherToken), 'list exam banks') as { id: string; scope: string }[];
    const myEBank = eBanks.find((b) => b.scope === 'personal');
    if (!myEBank) throw new Error('teacher1 personal exam bank not found');
    const exam = must(await call('POST', `/exams/banks/${myEBank.id}/exams`, ctx.ctx.teacherToken, {
      name: SAMPLE_EXAM_NAME, totalScore: 10,
      slots: [{ questionId: q1.question.id, maxMark: 5 }, { questionId: q2.question.id, maxMark: 5 }],
    }), 'create sample exam') as { paper: { id: string } };
    must(await call('POST', `/exams/${exam.paper.id}/status`, ctx.ctx.teacherToken, { status: 'ready' }), 'ready sample exam');
    const pin = must(await call('POST', `/courses/${ctx.courseId}/exam-pins`, ctx.ctx.teacherToken, {
      sectionId: ctx.week2, examId: exam.paper.id,
    }), 'pin sample exam') as { id: string };
    console.log(`[seed] sample exam pinned into DEMO101 (#${pin.id})`);
  }
}

/** Chương trình GDPT 2018: restore dump đông cứng qua ProgramDumpService (không chạy importer), chạy với ngữ cảnh platform để RLS thấy dữ liệu dùng chung. */
async function seedProgramDump(ctx: SeedContext): Promise<void> {
  // Chương trình GDPT 2018 (GDPT-SEED, issue #161; mô hình phân
  // phối chốt 20:09 ngày 26/10/2026): seed RESTORE DUMP ĐÔNG CỨNG
  // trong repo qua ProgramDumpService — KHÔNG chạy importer ở các
  // môi trường. ID trong dump là hằng số literal nên tập id khớp
  // 100% giữa mọi môi trường; DB đã có dữ liệu chương trình thì bỏ
  // qua (idempotent theo luật seed, không nhân đôi).
  const programDump = app.get(ProgramDumpService, { strict: false });
  const programStartedAt = Date.now();
  // TENANT-1 (#196): đường restore trực tiếp (không qua HTTP) chạy
  // với danh nghĩa hệ thống — bọc ngữ cảnh platform tường minh để
  // RLS fail-closed cho thấy/ghi được dữ liệu dùng chung của platform.
  const dumpResult = await tenantAls.run({ platform: true }, () => programDump.restoreIfEmpty());
  console.log(`[seed] program dump version=${dumpResult.version}: restored=${dumpResult.restored}, ${((Date.now() - programStartedAt) / 1000).toFixed(1)}s`);
}

/** Điểm mẫu: mục điểm 'Bài kiểm tra 1' + điểm student1=8.5, student2=6.5. */
async function seedSampleGrades(ctx: SeedContext): Promise<void> {
  const items = must(await call('GET', `/courses/${ctx.courseId}/grade-items`, ctx.adminToken), 'list grade items') as { id: string; itemName: string }[];
  let item = items.find((i) => i.itemName === 'Bài kiểm tra 1');
  if (!item) {
    item = must(await call('POST', `/courses/${ctx.courseId}/grade-items`, ctx.adminToken, { itemName: 'Bài kiểm tra 1', gradeMax: 10 }), 'create grade item') as { id: string; itemName: string };
    console.log(`[seed] grade item created (#${item.id})`);
  }
  const sampleGrades: [string, number][] = [[ctx.studentIds[0]!, 8.5], [ctx.studentIds[1]!, 6.5]];
  for (const [uid, grade] of sampleGrades) {
    must(await call('POST', `/grade-items/${item.id}/grades`, ctx.adminToken, { userId: uid, rawGrade: grade }), `set grade for ${uid}`);
  }
  console.log('[seed] sample grades set (student1=8.5, student2=6.5 / 10)');
}

/** Huy hiệu mẫu 'Huy hiệu khởi đầu': tạo + kích hoạt (nếu chưa có) rồi cấp cho student1 (nếu chưa cấp). */
async function seedSampleBadge(ctx: SeedContext): Promise<void> {
  const badges = must(await call('GET', '/badges', ctx.adminToken), 'list badges') as { id: string; name: string; status: number }[];
  let badge = badges.find((b) => b.name === 'Huy hiệu khởi đầu');
  if (!badge) {
    badge = must(await call('POST', '/badges', ctx.adminToken, { name: 'Huy hiệu khởi đầu', type: 1, issuerName: 'Giáo khoa Review', description: 'Cấp thủ công cho student1 để xem ngay trong buổi review.' }), 'create badge') as { id: string; name: string; status: number };
    must(await call('PUT', `/badges/${badge.id}/criteria`, ctx.adminToken, { method: 1, criteria: [{ criteriaType: 'manual', params: {} }] }), 'set badge criteria');
    must(await call('POST', `/badges/${badge.id}/status`, ctx.adminToken, { status: 1 }), 'activate badge');
    console.log(`[seed] badge created + activated (#${badge.id})`);
  }
  const issued = must(await call('GET', `/badges/${badge.id}/issued`, ctx.adminToken), 'list issued') as { userId: string }[];
  if (!issued.some((i) => i.userId === ctx.studentIds[0])) {
    must(await call('POST', `/badges/${badge.id}/award`, ctx.adminToken, { userId: ctx.studentIds[0] }), 'award badge');
    console.log('[seed] badge awarded to student1');
  } else console.log('[seed] badge already awarded to student1');
}

/** Sự kiện lịch mẫu 'Buổi học trực tuyến đầu tiên' (ngày mai 09:00; đã có thì bỏ qua). */
async function seedCalendarEvent(ctx: SeedContext): Promise<void> {
  const events = must(await call('GET', '/calendar/events', ctx.adminToken), 'list events') as { id: string; name: string }[];
  if (!events.some((e) => e.name === 'Buổi học trực tuyến đầu tiên')) {
    const tomorrow = new Date(Date.now() + DAY_MS);
    tomorrow.setHours(9, 0, 0, 0);
    must(await call('POST', '/calendar/events', ctx.adminToken, {
      name: 'Buổi học trực tuyến đầu tiên', eventType: 'course', ctx.courseId: ctx.ctx.courseId, timeStart: tomorrow.toISOString(),
    }), 'create calendar event');
    console.log('[seed] calendar event created (tomorrow 09:00)');
  } else console.log('[seed] calendar event exists');
}

async function main(): Promise<void> {
  const { app, call } = await startSeedApp();
  const ctx: SeedContext = {
    app, call,
    adminToken: '', teacherId: '', studentIds: [], guardianId: '',
    classId: '', courseId: '',
    courseContent: { contextId: '', sections: [] },
    teacherToken: '', week1: '', week2: '',
  };
  try {
    await seedDemoUsers(ctx);
    await seedSchoolTenant(ctx);
    await seedDemoCourse(ctx);
    await seedEnrolment(ctx);
    await seedGuardianLink(ctx);
    await seedSampleAssignment(ctx);
    await seedSampleExam(ctx);
    await seedProgramDump(ctx);
    await seedSampleGrades(ctx);
    await seedSampleBadge(ctx);
    await seedCalendarEvent(ctx);
    console.log('[seed] DONE — sample data ready. Accounts: see README "Review" section.');
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error('[seed] FAILED', err);
  process.exit(1);
});
