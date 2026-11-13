/**
 * Khu quản lý competency + hàng đợi duyệt của trang kế hoạch học tập
 * (`features/learning-plan/routes/learning-plan.tsx`): trang chỉ render component này khi
 * người dùng có quyền quản trị (`canAdminister` từ `usePermissions()` ở trang).
 *
 * Luồng dữ liệu đi qua tầng TanStack Query
 * (`features/learning-plan/queries/learning-plan.ts`, khuôn F-01 của rà soát #133) thay cho
 * vòng fetch thủ công bằng `useState`/`useEffect` + `apiJson` trước đây:
 *   - Đọc: danh sách framework, danh sách mẫu kế hoạch, cây năng lực
 *     của framework đang chọn, danh sách người dùng cho ô chọn duyệt và cặp dữ liệu hàng đợi duyệt (kế hoạch + năng lực của người dùng đang xét) đều là `useQuery` theo khoá của `features/learning-plan/queries/keys.ts`. Cây năng lực và hàng đợi giữ dữ liệu trước trong lúc tải dữ liệu mới (`keepPreviousData`) như bản thủ công chỉ thay danh sách khi lần tải xong.
 *   - Ghi: mọi thao tác là `useMutation`; thành công thì invalidate
 *     đúng cụm khoá liên quan (tạo/nhập framework và tạo mẫu làm mới cả hai danh sách khung; thêm năng lực làm mới cây của framework đó; thao tác duyệt làm mới hàng đợi) thay cho lời gọi nạp lại thủ công.
 *   - Xuất framework là lần đọc tại thời điểm bấm: lấy tài liệu qua
 *     `fetchQuery` với `staleTime: 0` rồi đóng gói Blob tải xuống ngay trên trình duyệt, không qua máy chủ tệp.
 *   - Thông báo thành công/thất bại theo từng thao tác vẫn giữ ở
 *     state cục bộ của component như bản thủ công; riêng lỗi tải dữ liệu phơi thẳng từ trạng thái lỗi của các query.
 *
 * Hiển thị tách thành ba thẻ con trong cùng thư mục `components/` (S5 của rà soát code style): `CompetencyFrameworkCard` (thẻ framework + cây năng lực), `CompetencyTemplateCard` (thẻ mẫu kế hoạch) và `CompetencyReviewQueueCard` (thẻ hàng đợi duyệt). Component này chỉ giữ queries/mutations, thông báo, logic tự chọn mẫu đầu tiên và các hàm xử lý form rồi truyền xuống qua props.
 */
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, errorText } from '#lib/api';
import { frameworkExportQueryOptions, useAddTemplateCohort, useAddTemplateCompetency, useCompetencyFrameworks, useCompetencyTemplates, useCreateCompetency, useCreateCompetencyFramework, useCreateLearningPlanTemplate, useCreatePlansFromTemplate, useFrameworkCompetencies, useImportCompetencyFramework, usePlanReviewAction, useReviewQueuePlans, useReviewQueueUsercomps, useUsercompReviewAction, useUserOptions, userCompetenciesQueryOptions, userLearningPlansQueryOptions } from '../queries/learning-plan';
import type { PlanReviewActionName, UsercompReviewActionName } from '../types/learning-plan';
import type { FrameworkView } from '../types/types';
import { usePlanStatusLabels } from '../utils/plan-status';
import { CompetencyFrameworkCard, type CompetencyDraft, type FrameworkDraft } from './competency-framework-card';
import { CompetencyReviewQueueCard } from './competency-review-queue-card';
import { CompetencyTemplateCard, type TemplateDraft } from './competency-template-card';

/**
 * Khu quản lý competency + hàng đợi duyệt, chỉ render khi người dùng có quyền quản trị (`canAdminister` từ `usePermissions()`).
 *
 * Đối chiếu DTO ở `packages/contracts/src/engagement.ts` (bản ở worktree này) và controller/service ở `apps/api/src/modules/competencies`:
 * - Tạo framework: `createCompetencyFrameworkSchema` = `{ shortName,
 *   idNumber?, description?, scale: { values: string[], proficient:
 *   number[] }, visible? }` — form thu values/proficient dạng danh sách phân tách bằng dấu phẩy rồi đóng gói đúng hình dạng đó.
 * - Thêm competency: `createCompetencySchema` = `{ shortName, idNumber?,
 *   description?, parentId? }` vào `POST /frameworks/:id/competencies`.
 * - Tạo template: `createLearningPlanTemplateSchema` = `{ shortName,
 *   description?, dueDate? }`; gắn competency/cohort lần lượt là `addTemplateCompetencySchema` = `{ competencyId }` và `addTemplateCohortSchema` = `{ cohortId }`; `create-plans` không có body.
 *
 * Quy tắc hiện nút duyệt lấy đúng từ `planTransition` và `transitionUsercompReview` trong competencies.service:
 * - Plan (0 nháp, 1 đang thực hiện, 2 chờ duyệt, 3 đang duyệt, 4 hoàn
 *   thành): start-review chỉ từ 2; approve chỉ từ 3; unapprove chỉ từ 1; complete từ 1 hoặc 3.
 * - Usercomp (0 chưa duyệt, 1 chờ duyệt, 2 đang duyệt): start-review chỉ
 *   từ 1; approve/reject từ 1 hoặc 2, body lần lượt là `competencyReviewDecisionSchema` và `competencyNoteSchema` (mọi trường đều tuỳ chọn nên gửi `{}` khi không nhập grade/note).
 */
export function CompetencyAdmin() {
  const { t } = useTranslation('app');
  const planStatusLabels = usePlanStatusLabels();
  const queryClient = useQueryClient();
  const frameworksQuery = useCompetencyFrameworks();
  const templatesQuery = useCompetencyTemplates();
  const frameworks = frameworksQuery.data ?? [];
  const templates = templatesQuery.data ?? [];
  const firstTemplateId = templatesQuery.data?.[0]?.id;
  const [selectedFrameworkId, setSelectedFrameworkId] = useState('');
  const competenciesQuery = useFrameworkCompetencies(selectedFrameworkId);
  const competencies = competenciesQuery.data ?? [];
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  /**
   * Lỗi tải dữ liệu của khu quản trị (danh sách framework/template hoặc cây năng lực) phơi thẳng từ trạng thái lỗi của các query — tương đương bản thủ công đặt lỗi khi lần nạp ban đầu hoặc lần nạp cây thất bại; lần nạp lại thành công thì lỗi tự biến mất.
   */
  const adminError =
    frameworksQuery.isError || templatesQuery.isError || competenciesQuery.isError
      ? t('compAdminLoadFailed')
      : null;
  const [fwDraft, setFwDraft] = useState<FrameworkDraft>({
    shortName: '',
    idNumber: '',
    description: '',
    scaleValues: '',
    scaleProficient: '',
    visible: true,
  });
  const [compDraft, setCompDraft] = useState<CompetencyDraft>({ shortName: '', idNumber: '', description: '', parentId: '' });
  const [tplDraft, setTplDraft] = useState<TemplateDraft>({ shortName: '', description: '', dueDate: '' });
  const [tplCompetencyId, setTplCompetencyId] = useState('');
  const [tplCohortId, setTplCohortId] = useState('');
  const usersQuery = useUserOptions();
  const users = usersQuery.data ?? [];
  const [reviewUserId, setReviewUserId] = useState('');
  const [queueUserId, setQueueUserId] = useState<string | null>(null);
  const reviewPlansQuery = useReviewQueuePlans(queueUserId);
  const reviewUsercompsQuery = useReviewQueueUsercomps(queueUserId);
  const reviewPlans = queueUserId === null ? null : (reviewPlansQuery.data ?? null);
  const reviewUsercomps = queueUserId === null ? null : (reviewUsercompsQuery.data ?? null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importInputKey, setImportInputKey] = useState(0);
  const createFrameworkMutation = useCreateCompetencyFramework();
  const importFrameworkMutation = useImportCompetencyFramework();
  const createCompetencyMutation = useCreateCompetency();
  const createTemplateMutation = useCreateLearningPlanTemplate();
  const addTemplateCompetencyMutation = useAddTemplateCompetency();
  const addTemplateCohortMutation = useAddTemplateCohort();
  const createPlansMutation = useCreatePlansFromTemplate();
  const planReviewMutation = usePlanReviewAction();
  const usercompReviewMutation = useUsercompReviewAction();

  /**
   * Chọn sẵn mẫu đầu tiên khi danh sách mẫu đã nạp mà chưa có mẫu nào được chọn — đúng mặc định của bản thủ công, vốn chọn sẵn mẫu đầu mỗi lần nạp lại hai danh sách khung quản trị.
   */
  if (selectedTemplateId === '' && firstTemplateId) {
    setSelectedTemplateId(firstTemplateId);
  }

  /**
   * Chọn framework để xem cây năng lực của nó; bấm lại framework đang chọn thì nạp lại cây của nó như bản thủ công gọi lại mỗi lần bấm.
   */
  function selectFramework(frameworkId: string) {
    if (frameworkId === selectedFrameworkId) {
      void competenciesQuery.refetch();
    } else {
      setSelectedFrameworkId(frameworkId);
    }
  }

  /** Tạo framework qua POST /frameworks với đúng body của `createCompetencyFrameworkSchema`. */
  async function createFramework(event: FormEvent) {
    event.preventDefault();
    setAdminMessage(null);
    const values = fwDraft.scaleValues
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    const proficient = fwDraft.scaleProficient
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .map(Number);
    try {
      await createFrameworkMutation.mutateAsync({
        shortName: fwDraft.shortName,
        ...(fwDraft.idNumber.trim() ? { idNumber: fwDraft.idNumber.trim() } : {}),
        ...(fwDraft.description.trim() ? { description: fwDraft.description.trim() } : {}),
        scale: { values, proficient },
        visible: fwDraft.visible,
      });
      setFwDraft({ shortName: '', idNumber: '', description: '', scaleValues: '', scaleProficient: '', visible: true });
      setAdminMessage(t('compFrameworkCreated'));
    } catch (err) {
      setAdminMessage(errorText(err, t('compFrameworkCreateFailed')));
    }
  }

  /**
   * Xuất framework ra file JSON: GET /frameworks/:id/export trả tài liệu JSON của hệ thống (framework + cây competency + rule); trang đóng gói thành Blob tải xuống ngay trên trình duyệt, không qua máy chủ tệp.
   */
  async function exportFramework(fw: FrameworkView) {
    setAdminMessage(null);
    try {
      const doc = await queryClient.fetchQuery(frameworkExportQueryOptions(fw.id));
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `framework-${fw.shortName || fw.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setAdminMessage(t('compExported', { name: fw.shortName }));
    } catch (err) {
      setAdminMessage(errorText(err, t('compExportFailed')));
    }
  }

  /**
   * Nhập framework từ file JSON đã xuất: đọc file ngay trên trình duyệt,
   * phân tích JSON rồi POST /frameworks/import — backend kiểm chứng toàn
   * vẹn tài liệu bằng `frameworkExportSchema` và tạo framework MỚI (mọi id
   * đều mới). Lỗi toàn vẹn của API (Problem Details) được hiện nguyên văn
   * `detail` để quản trị sửa file, không nuốt thành thông báo chung chung.
   */
  async function importFramework(event: FormEvent) {
    event.preventDefault();
    setAdminMessage(null);
    setImportError(null);
    if (!importFile) return;
    let doc: unknown;
    try {
      doc = JSON.parse(await importFile.text());
    } catch (err) {
      setImportError(errorText(err, t('compImportInvalidJson')));
      return;
    }
    try {
      const created = await importFrameworkMutation.mutateAsync(doc);
      setImportFile(null);
      setImportInputKey((k) => k + 1);
      setAdminMessage(t('compImportSuccess', { name: created.shortName }));
    } catch (err) {
      setImportError(
        err instanceof ApiError
          ? t('compImportApiError', { detail: err.problem.detail ?? err.problem.title })
          : t('compImportFailed'),
      );
    }
  }

  /** Thêm competency vào framework đang chọn qua POST /frameworks/:id/competencies (`createCompetencySchema`). */
  async function createCompetency(event: FormEvent) {
    event.preventDefault();
    if (!selectedFrameworkId) return;
    setAdminMessage(null);
    try {
      await createCompetencyMutation.mutateAsync({
        frameworkId: selectedFrameworkId,
        body: {
          shortName: compDraft.shortName,
          ...(compDraft.idNumber.trim() ? { idNumber: compDraft.idNumber.trim() } : {}),
          ...(compDraft.description.trim() ? { description: compDraft.description.trim() } : {}),
          ...(compDraft.parentId ? { parentId: compDraft.parentId } : {}),
        },
      });
      setCompDraft({ shortName: '', idNumber: '', description: '', parentId: '' });
      setAdminMessage(t('compCompetencyCreated'));
    } catch (err) {
      setAdminMessage(errorText(err, t('compCompetencyCreateFailed')));
    }
  }

  /** Tạo template qua POST /templates (`createLearningPlanTemplateSchema`). */
  async function createTemplate(event: FormEvent) {
    event.preventDefault();
    setAdminMessage(null);
    try {
      const created = await createTemplateMutation.mutateAsync({
        shortName: tplDraft.shortName,
        ...(tplDraft.description.trim() ? { description: tplDraft.description.trim() } : {}),
        ...(tplDraft.dueDate ? { dueDate: tplDraft.dueDate } : {}),
      });
      setTplDraft({ shortName: '', description: '', dueDate: '' });
      setSelectedTemplateId(created.id);
      setAdminMessage(t('compTemplateCreated'));
    } catch (err) {
      setAdminMessage(errorText(err, t('compTemplateCreateFailed')));
    }
  }

  /** Gắn competency vào template đang chọn: POST /templates/:id/competencies với `{ competencyId }`. */
  async function addTemplateCompetency(event: FormEvent) {
    event.preventDefault();
    if (!selectedTemplateId) return;
    setAdminMessage(null);
    try {
      await addTemplateCompetencyMutation.mutateAsync({
        templateId: selectedTemplateId,
        competencyId: tplCompetencyId.trim(),
      });
      setTplCompetencyId('');
      setAdminMessage(t('compTemplateCompetencyAdded'));
    } catch (err) {
      setAdminMessage(errorText(err, t('compActionFailed')));
    }
  }

  /** Gắn cohort vào template đang chọn: POST /templates/:id/cohorts với `{ cohortId }`. */
  async function addTemplateCohort(event: FormEvent) {
    event.preventDefault();
    if (!selectedTemplateId) return;
    setAdminMessage(null);
    try {
      await addTemplateCohortMutation.mutateAsync({
        templateId: selectedTemplateId,
        cohortId: tplCohortId.trim(),
      });
      setTplCohortId('');
      setAdminMessage(t('compTemplateCohortAdded'));
    } catch (err) {
      setAdminMessage(errorText(err, t('compActionFailed')));
    }
  }

  /** Sinh plan cho mọi thành viên cohort đã gắn: POST /templates/:id/create-plans (không body). */
  async function createPlansFromTemplate() {
    if (!selectedTemplateId) return;
    setAdminMessage(null);
    try {
      const res = await createPlansMutation.mutateAsync({ templateId: selectedTemplateId });
      setAdminMessage(t('compPlansCreated', { count: res.created }));
    } catch (err) {
      setAdminMessage(errorText(err, t('compActionFailed')));
    }
  }

  /**
   * Tải plans + usercomp của người dùng đang nhập trong hàng đợi
   * duyệt: bật cặp query của hàng đợi cho người dùng đó và chờ cả hai
   * qua `fetchQuery` để báo lỗi đúng như bản thủ công — lỗi thì hiện
   * thông báo không tải được, hàng đợi cũ (nếu có) vẫn ở lại.
   */
  async function loadReviewQueue() {
    const uid = reviewUserId.trim();
    if (!uid) return;
    setQueueUserId(uid);
    try {
      await Promise.all([
        queryClient.fetchQuery(userLearningPlansQueryOptions(uid)),
        queryClient.fetchQuery(userCompetenciesQueryOptions(uid)),
      ]);
    } catch (err) {
      setAdminMessage(errorText(err, t('compReviewQueueLoadFailed')));
    }
  }

  /**
   * Sau thao tác duyệt, bản thủ công nạp lại hàng đợi theo đúng id
   * đang nhập ở ô hàng đợi: nếu id đó là người dùng khác với hàng đợi
   * đang hiển thị thì chuyển hàng đợi sang người dùng đó (cặp query tự
   * tải); trùng thì invalidate của đột biến đã làm mới tại chỗ.
   */
  function syncQueueWithInput() {
    const uid = reviewUserId.trim();
    if (uid && uid !== queueUserId) setQueueUserId(uid);
  }

  /** Thao tác duyệt trên một plan (start-review/approve/unapprove/complete), xong tải lại hàng đợi. */
  async function planReviewAction(planId: string, action: PlanReviewActionName) {
    setAdminMessage(null);
    try {
      await planReviewMutation.mutateAsync({ planId, action, userId: reviewUserId.trim() });
      setAdminMessage(t('compReviewActionDone'));
      syncQueueWithInput();
    } catch (err) {
      setAdminMessage(errorText(err, t('compReviewActionFailed')));
    }
  }

  /** Thao tác duyệt trên một usercomp (start-review/approve/reject), xong tải lại hàng đợi. */
  async function usercompReviewAction(usercompId: string, action: UsercompReviewActionName) {
    setAdminMessage(null);
    try {
      await usercompReviewMutation.mutateAsync({ usercompId, action, userId: reviewUserId.trim() });
      setAdminMessage(t('compReviewActionDone'));
      syncQueueWithInput();
    } catch (err) {
      setAdminMessage(errorText(err, t('compReviewActionFailed')));
    }
  }

  return (
    <>
      <CompetencyFrameworkCard
        frameworks={frameworks}
        competencies={competencies}
        selectedFrameworkId={selectedFrameworkId}
        onSelectFramework={selectFramework}
        adminError={adminError}
        adminMessage={adminMessage}
        frameworkDraft={fwDraft}
        onFrameworkDraftChange={setFwDraft}
        competencyDraft={compDraft}
        onCompetencyDraftChange={setCompDraft}
        importFile={importFile}
        onImportFileChange={setImportFile}
        importError={importError}
        importInputKey={importInputKey}
        onCreateFramework={createFramework}
        onExportFramework={exportFramework}
        onImportFramework={importFramework}
        onCreateCompetency={createCompetency}
      />
      <CompetencyTemplateCard
        templates={templates}
        selectedTemplateId={selectedTemplateId}
        onSelectTemplate={setSelectedTemplateId}
        templateDraft={tplDraft}
        onTemplateDraftChange={setTplDraft}
        templateCompetencyId={tplCompetencyId}
        onTemplateCompetencyIdChange={setTplCompetencyId}
        templateCohortId={tplCohortId}
        onTemplateCohortIdChange={setTplCohortId}
        onCreateTemplate={createTemplate}
        onAddTemplateCompetency={addTemplateCompetency}
        onAddTemplateCohort={addTemplateCohort}
        onCreatePlansFromTemplate={createPlansFromTemplate}
      />
      <CompetencyReviewQueueCard
        users={users}
        reviewUserId={reviewUserId}
        onReviewUserIdChange={setReviewUserId}
        reviewPlans={reviewPlans}
        reviewUsercomps={reviewUsercomps}
        planStatusLabels={planStatusLabels}
        onLoadReviewQueue={loadReviewQueue}
        onPlanReviewAction={planReviewAction}
        onUsercompReviewAction={usercompReviewAction}
      />
    </>
  );
}
