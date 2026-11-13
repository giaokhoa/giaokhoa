import { useCallback, useState, type FormEvent } from 'react';
import type { Route } from './+types/course-builder';
import { Link, useNavigate, useParams } from 'react-router';
import { CurriculumFramePanel, BookFramePanel } from '../components/curriculum-frame-panel';
import { Card, CardContent, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { useTranslation } from 'react-i18next';
import '#config/i18n';
import { fetchItems, insertItem } from '#features/content-bank/api/content-bank';
import type { LibraryItem } from '#features/content-bank/types/content-bank';
import { courseBuilderQueryOptions, coursesListQueryOptions, useCourseBuilder, useCourseContent, useCoursesList, useCreateBuilderAssignment, useCreateBuilderExamPin, useCreateBuilderModule, useCreateBuilderSection, useDeleteBuilderModule, useDeleteBuilderSection, useDuplicateBuilderModule, useDuplicateBuilderSection, useImportBuilderContent, useRecalculateBuilderCompletion, useReorderBuilderModules, useReorderBuilderSections, useSaveBuilderCourse, useSaveBuilderCriteria, useSaveBuilderModule, useSaveBuilderSection } from '../queries/course-builder';
import { queryClient } from '#lib/query-client';
import { usePermissions } from '#lib/permissions';
import { CompletionCard } from '../components/completion-card';
import { CourseInfoCard } from '../components/course-info-card';
import { ImportCard } from '../components/import-card';
import { OutlineCard } from '../components/outline-card';
import { CRITERIA_METHOD, statusChoiceOf, type ItemStatusChoice } from '../utils/utils';
import { titleMeta } from '#lib/route-meta';

/**
 * Builder Outline (K1 — issue #68): trang xây dựng khoá học RIÊNG, tách khỏi trang quản trị khoá gộp theo chuẩn §9. Gồm: thông tin khoá
 * (+ cờ khoá mẫu tổ/trường), panel "Thêm từ khung" (K0a), outline
 * section/module với kéo–thả đổi thứ tự (kèm nút lên/xuống), nhân bản/xoá ngay tại dòng, thêm nội dung bằng MENU chọn loại (không gõ chuỗi component), khối "Thêm từ kho" trong từng section (CB-1 — issue #107: cắm học liệu của Kho học liệu vào section qua endpoint insert sẵn có của CB-1), trạng thái Nháp/Đã mở/Mở theo lịch qua trường ngày mở `openAt` riêng, điều kiện truy cập nâng cao
 * (availability) giữ nguyên từ bản cũ, panel "Dùng lại từ khoá khác"
 * và tiêu chí hoàn thành khoá. Quyền: teaching của khoá hoặc quản trị hệ thống — API vẫn thực thi capability thật cho từng thao tác ghi.
 */
export function CourseBuilderPage() {
  const { t } = useTranslation('app');
  const { id } = useParams();
  const courseId = id ?? '';
  const perms = usePermissions();
  const navigate = useNavigate();

  const courseAccess = perms.courses.find((c) => c.course.id === courseId);
  const canBuild =
    perms.canAdminister ||
    perms.teaching.some((c) => c.course.id === courseId) ||
    (courseAccess?.capabilities.includes('course:update') ?? false);
  const canManageCompletion =
    perms.canAdminister || (courseAccess?.capabilities.includes('completion:manage') ?? false);

  // Dữ liệu trang qua TanStack (F-01 đợt 1): gói builder là một query
  // (clientLoader đã prefetch cùng khoá); chờ tải đầu qua trạng thái
  // chưa có dữ liệu gói như trước (F-14).
  const builderQuery = useCourseBuilder(courseId, canBuild);
  const builderData = builderQuery.data;
  const course = builderData?.course ?? null;
  const content = builderData?.content ?? null;
  const groups = builderData?.groups ?? [];
  const groupings = builderData?.groupings ?? [];
  const gradeItems = builderData?.gradeItems ?? [];
  const { refetch } = builderQuery;
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Form thông tin khoá.
  const [fullName, setFullname] = useState('');
  const [shortName, setShortname] = useState('');
  const [courseCategory, setCourseCategory] = useState('');
  const [summary, setSummary] = useState('');
  const [courseVisible, setCourseVisible] = useState(true);
  const [isTemplate, setIsTemplate] = useState(false);
  const [startDate, setStartdate] = useState('');
  const [endDate, setEnddate] = useState('');
  // Outline.
  const [newSectionName, setNewSectionName] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [sectionEdits, setSectionEdits] = useState<Record<string, { name: string; status: ItemStatusChoice; openAt: string }>>({});
  const [moduleEdits, setModuleEdits] = useState<Record<string, { name: string; status: ItemStatusChoice; openAt: string }>>({});
  const [moduleDrafts, setModuleDrafts] = useState<Record<string, { component: string; name: string }>>({});
  // Thêm từ kho học liệu (CB-1, issue #107).
  const [bankOpenSectionId, setBankOpenSectionId] = useState<string | null>(null);
  const [bankItems, setBankItems] = useState<LibraryItem[] | null>(null);
  const [bankQuery, setBankQuery] = useState('');
  const [bankLoadError, setBankLoadError] = useState<string | null>(null);
  const [bankBusyId, setBankBusyId] = useState<string | null>(null);
  const [availabilityDrafts, setAvailabilityDrafts] = useState<Record<string, unknown>>({});
  const [dragSectionId, setDragSectionId] = useState<string | null>(null);
  const [dragModule, setDragModule] = useState<{ sectionId: string; moduleId: string } | null>(null);
  // Dùng lại từ khoá khác.
  const otherCourses = (useCoursesList().data ?? []).filter((c) => c.id !== courseId);
  const [importSourceId, setImportSourceId] = useState('');
  const importContent = useCourseContent(importSourceId).data ?? null;
  const [importSections, setImportSections] = useState<string[]>([]);
  const [importModules, setImportModules] = useState<string[]>([]);
  // Tiêu chí hoàn thành.
  const [criteriaMethod, setCriteriaMethod] = useState(CRITERIA_METHOD.all);
  const [criteriaDraft, setCriteriaDraft] = useState<{ criteriaType: string; moduleInstance: string; date: string }[]>([]);

  // Khởi tạo các trường form/bản nháp từ gói dữ liệu mỗi khi gói
  // (lại) tải về — đúng phần khởi tạo của reload() thủ công trước đây
  // (chạy lúc mở trang và sau mỗi đột biến, qua refetch ở dưới).
  const [previousBuilderData, setPreviousBuilderData] = useState<typeof builderData | undefined>(undefined);
  if (previousBuilderData !== builderData) {
    setPreviousBuilderData(builderData);
    if (builderData) {
      const { course: courseRes, content: contentRes, criteria: criteriaRes } = builderData;
      if (criteriaRes) {
        setCriteriaMethod(criteriaRes.method);
        setCriteriaDraft(
          criteriaRes.criteria.map((criterion) => ({
            criteriaType: criterion.criteriaType,
            moduleInstance: criterion.moduleInstance ?? '',
            date: criterion.date ? String(criterion.date).slice(0, 10) : '',
          })),
        );
      }
      if (courseRes) {
        setFullname(courseRes.fullName);
        setShortname(courseRes.shortName);
        setCourseCategory(courseRes.category);
        setSummary(courseRes.summary);
        setCourseVisible(courseRes.visible);
        setIsTemplate(courseRes.isTemplate);
        setStartdate(courseRes.startDate ? courseRes.startDate.slice(0, 10) : '');
        setEnddate(courseRes.endDate ? courseRes.endDate.slice(0, 10) : '');
      }
      if (contentRes) {
        setSectionEdits(
          Object.fromEntries(
            contentRes.sections.map((s) => [
              s.id,
              {
                name: s.name ?? '',
                status: statusChoiceOf(s.visible, s.openAt),
                openAt: s.openAt ? String(s.openAt).slice(0, 10) : '',
              },
            ]),
          ),
        );
        setModuleEdits(
          Object.fromEntries(
            contentRes.sections.flatMap((s) =>
              s.modules.map((m) => [
                m.id,
                {
                  name: m.name,
                  status: statusChoiceOf(m.visible, m.openAt),
                  openAt: m.openAt ? String(m.openAt).slice(0, 10) : '',
                },
              ]),
            ),
          ),
        );
        setAvailabilityDrafts(
          Object.fromEntries([
            ...contentRes.sections.map((s) => [`section:${s.id}`, s.availability ?? null] as const),
            ...contentRes.sections.flatMap((s) => s.modules.map((m) => [`module:${m.id}`, m.availability ?? null] as const)),
          ]),
        );
      }
      if (!courseRes && !contentRes) setLoadError(t('builderLoadFailed'));
    }
  }

  // Mọi thao tác ghi đi qua các đột biến của features/course-builder/queries/course-builder
  // (F-01): đột biến tự làm mới gói builder — dữ liệu mới về thì
  // effect khởi tạo ở trên chạy lại. reload() chỉ còn cho nhịp cắm
  // học liệu từ kho (endpoint insert của CB-1 nằm ngoài module này)
  // và nhịp tự khớp lại sau khi đổi thứ tự thất bại.
  const reload = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const saveCourseMutation = useSaveBuilderCourse(courseId);
  const createSectionMutation = useCreateBuilderSection(courseId);
  const saveSectionMutation = useSaveBuilderSection(courseId);
  const deleteSectionMutation = useDeleteBuilderSection(courseId);
  const duplicateSectionMutation = useDuplicateBuilderSection(courseId);
  const reorderSectionsMutation = useReorderBuilderSections(courseId);
  const reorderModulesMutation = useReorderBuilderModules(courseId);
  const createExamPinMutation = useCreateBuilderExamPin(courseId);
  const createAssignmentMutation = useCreateBuilderAssignment(courseId);
  const createModuleMutation = useCreateBuilderModule(courseId);
  const saveModuleMutation = useSaveBuilderModule(courseId);
  const deleteModuleMutation = useDeleteBuilderModule(courseId);
  const duplicateModuleMutation = useDuplicateBuilderModule(courseId);
  const importContentMutation = useImportBuilderContent(courseId);
  const saveCriteriaMutation = useSaveBuilderCriteria(courseId);
  const recalculateMutation = useRecalculateBuilderCompletion(courseId);

  // Đổi khoá nguồn "Dùng lại từ khoá khác" thì bỏ các tích chọn cũ (setState trong lúc render: chỉ chạy đúng nhịp đổi nguồn, các lần render sau không đổi gì thêm).
  const [previousImportSourceId, setPreviousImportSourceId] = useState(importSourceId);
  if (previousImportSourceId !== importSourceId) {
    setPreviousImportSourceId(importSourceId);
    setImportSections([]);
    setImportModules([]);
  }

  /**
   * Khuôn chung cho các thao tác ghi của trang: xoá thông báo cũ, gọi thao tác, báo thành công khi xong, báo thất bại khi lỗi (không lộ chi tiết lỗi ra giao diện). `okKey` bỏ trống khi thành công không cần báo (đổi thứ tự); `onFailed` cho bước riêng khi lỗi (đổi thứ tự thất bại thì tải lại). Trả về true khi thành công để handler có bước riêng sau đó quyết định tiếp. Hai handler có nhịp riêng (createModule điều hướng theo loại, insertFromBank giữ cờ bận) giữ thân riêng, không dùng helper này.
   */
  async function runWithMessage(options: {
    action: () => Promise<unknown>;
    okKey?: string;
    failedKey: string;
    onFailed?: () => Promise<unknown> | unknown;
  }): Promise<boolean> {
    setMessage(null);
    try {
      await options.action();
      if (options.okKey) setMessage(t(options.okKey));
      return true;
    } catch {
      setMessage(t(options.failedKey));
      await options.onFailed?.();
      return false;
    }
  }

  async function saveCourse(event: FormEvent) {
    event.preventDefault();
    await runWithMessage({
      action: () =>
        saveCourseMutation.mutateAsync({
          fullName,
          shortName,
          category: courseCategory,
          summary,
          visible: courseVisible,
          isTemplate,
          startDate: startDate ? startDate : null,
          endDate: endDate ? endDate : null,
        }),
      okKey: 'courseSaved',
      failedKey: 'courseSaveFailed',
    });
  }

  async function createSection(event: FormEvent) {
    event.preventDefault();
    await runWithMessage({
      action: () =>
        createSectionMutation
          .mutateAsync(newSectionName.trim() ? { name: newSectionName.trim() } : {})
          .then(() => setNewSectionName('')),
      okKey: 'sectionCreated',
      failedKey: 'sectionCreateFailed',
    });
  }

  /** Lưu tên + trạng thái mở của section: Nháp = ẩn; Đã mở = hiện, không lịch; Mở theo lịch = hiện + openAt. */
  async function saveSection(sectionId: string) {
    const edit = sectionEdits[sectionId];
    if (!edit) return;
    await runWithMessage({
      action: () =>
        saveSectionMutation.mutateAsync({
          sectionId,
          body: {
            name: edit.name,
            visible: edit.status !== 'draft',
            openAt: edit.status === 'scheduled' && edit.openAt ? new Date(`${edit.openAt}T00:00:00`).toISOString() : null,
          },
        }),
      okKey: 'sectionSaved',
      failedKey: 'sectionSaveFailed',
    });
  }

  async function deleteSection(sectionId: string, sectionName: string) {
    if (!window.confirm(t('confirmDeleteSection', { name: sectionName }))) return;
    await runWithMessage({
      action: () => deleteSectionMutation.mutateAsync(sectionId),
      okKey: 'sectionDeleted',
      failedKey: 'sectionDeleteFailed',
    });
  }

  async function duplicateSection(sectionId: string) {
    await runWithMessage({
      action: () => duplicateSectionMutation.mutateAsync(sectionId),
      okKey: 'builderDuplicated',
      failedKey: 'builderDuplicateFailed',
    });
  }

  /** Đổi thứ tự section: gửi toàn bộ danh sách id theo thứ tự mới (API đòi đủ mọi section). */
  async function reorderSections(orderedIds: string[]) {
    await runWithMessage({
      action: () => reorderSectionsMutation.mutateAsync(orderedIds),
      failedKey: 'builderReorderFailed',
      onFailed: reload,
    });
  }

  async function reorderModules(sectionId: string, orderedIds: string[]) {
    await runWithMessage({
      action: () => reorderModulesMutation.mutateAsync({ sectionId, moduleIds: orderedIds }),
      failedKey: 'builderReorderFailed',
      onFailed: reload,
    });
  }

  /**
   * Thêm nội dung bằng menu chọn loại: `mod_quiz` đi qua endpoint
   * exam-pins dạng newExam (tạo đề + ghim, tự tạo module + grade item
   * rồi mở trang lần ghim); các loại khác qua POST
   * /courses/:id/modules — không còn ô gõ chuỗi component.
   */
  async function createModule(event: FormEvent, sectionId: string) {
    event.preventDefault();
    const draft = moduleDrafts[sectionId] ?? { component: 'mod_page', name: '' };
    setMessage(null);
    try {
      if (draft.component === 'mod_quiz') {
        if (!draft.name.trim()) return;
        // Sau gộp Đề (#226): "thêm bài kiểm tra" = tạo ĐỀ mới trong
        // bank cá nhân của GV + GHIM vào khoá trong một thao tác
        // (newExam); GV soạn câu hỏi tiếp ở trình soạn đề của pin.
        const created = await createExamPinMutation.mutateAsync({ sectionId, name: draft.name.trim() });
        await navigate(`/courses/${courseId}/exams/${created.id}`);
        return;
      }
      if (draft.component === 'mod_assign') {
        if (!draft.name.trim()) return;
        const created = await createAssignmentMutation.mutateAsync({ sectionId, name: draft.name.trim() });
        await navigate(`/courses/${courseId}/assignments/${created.id}`);
        return;
      }
      await createModuleMutation.mutateAsync({
        sectionId,
        component: draft.component,
        ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
      });
      setModuleDrafts((prev) => ({ ...prev, [sectionId]: { component: 'mod_page', name: '' } }));
      setMessage(t('moduleCreated'));
    } catch {
      setMessage(t('moduleCreateFailed'));
    }
  }

  /**
   * Mở/đóng panel "Thêm từ kho" của một section. Danh sách học liệu
   * tải lười biếng một lần cho cả trang (API list của CB-1 đã lọc
   * theo quyền xem: học liệu của mình + đã duyệt của đồng nghiệp).
   */
  async function toggleBankPanel(sectionId: string) {
    if (bankOpenSectionId === sectionId) {
      setBankOpenSectionId(null);
      return;
    }
    setBankOpenSectionId(sectionId);
    setBankQuery('');
    if (bankItems === null) {
      setBankLoadError(null);
      try {
        setBankItems(await fetchItems());
      } catch {
        setBankItems([]);
        setBankLoadError(t('builderBankLoadFailed'));
      }
    }
  }

  /**
   * Cắm một học liệu từ kho vào section: API insert của CB-1 tạo
   * module `mod_resource` bằng bản sao file trong context của module
   * mới (sửa ở kho không đổi bản đã cắm); reload để module hiện ngay
   * trong outline.
   */
  async function insertFromBank(item: LibraryItem, sectionId: string) {
    setMessage(null);
    setBankBusyId(item.id);
    try {
      await insertItem(item.id, courseId, sectionId);
      setMessage(t('builderBankInserted', { name: item.name }));
      await reload();
    } catch {
      setMessage(t('builderBankInsertFailed'));
    } finally {
      setBankBusyId(null);
    }
  }

  async function saveModule(cmId: string) {
    const edit = moduleEdits[cmId];
    if (!edit) return;
    await runWithMessage({
      action: () =>
        saveModuleMutation.mutateAsync({
          cmId,
          body: {
            name: edit.name,
            visible: edit.status !== 'draft',
            openAt: edit.status === 'scheduled' && edit.openAt ? new Date(`${edit.openAt}T00:00:00`).toISOString() : null,
          },
        }),
      okKey: 'moduleSaved',
      failedKey: 'moduleSaveFailed',
    });
  }

  async function deleteModule(cmId: string, moduleName: string) {
    if (!window.confirm(t('confirmDeleteModule', { name: moduleName }))) return;
    await runWithMessage({
      action: () => deleteModuleMutation.mutateAsync(cmId),
      okKey: 'moduleDeleted',
      failedKey: 'moduleDeleteFailed',
    });
  }

  async function duplicateModule(cmId: string) {
    await runWithMessage({
      action: () => duplicateModuleMutation.mutateAsync(cmId),
      okKey: 'builderDuplicated',
      failedKey: 'builderDuplicateFailed',
    });
  }

  async function saveSectionAvailability(sectionId: string) {
    await runWithMessage({
      action: () =>
        saveSectionMutation.mutateAsync({
          sectionId,
          body: { availability: availabilityDrafts[`section:${sectionId}`] ?? null },
        }),
      okKey: 'availabilitySaved',
      failedKey: 'availabilitySaveFailed',
    });
  }

  async function saveModuleAvailability(cmId: string) {
    await runWithMessage({
      action: () =>
        saveModuleMutation.mutateAsync({
          cmId,
          body: { availability: availabilityDrafts[`module:${cmId}`] ?? null },
        }),
      okKey: 'availabilitySaved',
      failedKey: 'availabilitySaveFailed',
    });
  }

  /** "Dùng lại từ khoá khác": POST import-content với các section/module đã tích chọn ở khoá nguồn. */
  async function submitImport(event: FormEvent) {
    event.preventDefault();
    if (!importSourceId || (importSections.length === 0 && importModules.length === 0)) return;
    await runWithMessage({
      action: () =>
        importContentMutation
          .mutateAsync({
            sourceCourseId: importSourceId,
            ...(importSections.length ? { sectionIds: importSections } : {}),
            ...(importModules.length ? { moduleIds: importModules } : {}),
          })
          .then(() => {
            setImportSections([]);
            setImportModules([]);
          }),
      okKey: 'builderImported',
      failedKey: 'builderImportFailed',
    });
  }

  async function saveCriteria(event: FormEvent) {
    event.preventDefault();
    await runWithMessage({
      action: () =>
        saveCriteriaMutation.mutateAsync({
          method: criteriaMethod,
          criteria: criteriaDraft.map((criterion) => ({
            criteriaType: criterion.criteriaType,
            ...(criterion.criteriaType === 'module' ? { moduleInstance: criterion.moduleInstance } : {}),
            ...(criterion.criteriaType === 'date' ? { date: criterion.date } : {}),
          })),
        }),
      okKey: 'completionCriteriaSaved',
      failedKey: 'completionCriteriaSaveFailed',
    });
  }

  async function recalculateCompletion() {
    await runWithMessage({
      action: () => recalculateMutation.mutateAsync(),
      okKey: 'recalculatedCompletion',
      failedKey: 'recalculateFailed',
    });
  }

  if (!canBuild) {
    return (
      <main className="@container/main flex flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('courseBuilder')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t('builderNoAccess')}</p>
            <p className="pt-2 text-sm">
              <Link to={`/courses/${courseId}`}>{t('wizardBackToCourses')}</Link>
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const sections = content?.sections ?? [];
  const bankQueryNormalized = bankQuery.trim().toLowerCase();
  const bankFiltered = (bankItems ?? []).filter((item) => {
    if (!bankQueryNormalized) return true;
    const haystack = [item.name, item.description ?? '', ...(item.keywords ?? [])].join(' ').toLowerCase();
    return haystack.includes(bankQueryNormalized);
  });
  const statusBadge = (status: string | undefined) =>
    status === 'scheduled' ? t('builderStatusScheduled') : status === 'draft' ? t('builderStatusDraft') : t('builderStatusOpen');

  return (
    <main className="@container/main flex flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      <CourseInfoCard
        course={course}
        loadError={loadError}
        courseId={courseId}
        fullName={fullName}
        setFullname={setFullname}
        shortName={shortName}
        setShortname={setShortname}
        courseCategory={courseCategory}
        setCourseCategory={setCourseCategory}
        summary={summary}
        setSummary={setSummary}
        startDate={startDate}
        setStartdate={setStartdate}
        endDate={endDate}
        setEnddate={setEnddate}
        courseVisible={courseVisible}
        setCourseVisible={setCourseVisible}
        isTemplate={isTemplate}
        setIsTemplate={setIsTemplate}
        onSaveCourse={saveCourse}
        message={message}
      />

      <CurriculumFramePanel
        courseId={courseId}
        course={course}
        sections={sections.map((s) => ({ section: s.section, name: s.name }))}
        onApplied={() => void reload()}
      />

      <BookFramePanel
        courseId={courseId}
        course={course}
        sections={sections.map((s) => ({ section: s.section, name: s.name }))}
        onApplied={() => void reload()}
      />

      <OutlineCard
        state={{
          content,
          sections,
          newSectionName,
          setNewSectionName,
          collapsed,
          setCollapsed,
          dragSectionId,
          setDragSectionId,
          dragModule,
          setDragModule,
        }}
        edits={{ sectionEdits, setSectionEdits, moduleEdits, setModuleEdits, moduleDrafts, setModuleDrafts }}
        actions={{
          onCreateSection: createSection,
          onSaveSection: saveSection,
          onDeleteSection: deleteSection,
          onDuplicateSection: duplicateSection,
          onReorderSections: reorderSections,
          onReorderModules: reorderModules,
          onSaveModule: saveModule,
          onDeleteModule: deleteModule,
          onDuplicateModule: duplicateModule,
          onCreateModule: createModule,
        }}
        context={{ groups, groupings, gradeItems }}
        availability={{
          setAvailabilityDrafts,
          onSaveSectionAvailability: saveSectionAvailability,
          onSaveModuleAvailability: saveModuleAvailability,
        }}
        bank={{
          bankOpenSectionId,
          onToggleBankPanel: toggleBankPanel,
          bankQuery,
          setBankQuery,
          bankLoadError,
          bankItems,
          bankFiltered,
          bankBusyId,
          onInsertFromBank: insertFromBank,
        }}
        statusBadge={statusBadge}
      />

      <ImportCard
        otherCourses={otherCourses}
        importSourceId={importSourceId}
        setImportSourceId={setImportSourceId}
        importContent={importContent}
        importSections={importSections}
        setImportSections={setImportSections}
        importModules={importModules}
        setImportModules={setImportModules}
        onSubmitImport={submitImport}
      />

      <CompletionCard
        canManageCompletion={canManageCompletion}
        criteriaMethod={criteriaMethod}
        setCriteriaMethod={setCriteriaMethod}
        criteriaDraft={criteriaDraft}
        setCriteriaDraft={setCriteriaDraft}
        sections={sections}
        onSaveCriteria={saveCriteria}
        onRecalculate={recalculateCompletion}
      />
    </main>
  );
}

/** Export mặc định cho route module React Router framework mode (xem src/routes.ts). */
export default CourseBuilderPage;

/**
 * clientLoader (F-01 đợt 1 + bổ sung clientLoader, rà soát #133):
 * prefetch gói builder + danh sách khoá vào QueryClient singleton
 * (đúng khoá factory) trước khi component mount. prefetchQuery
 * không ném lỗi: tải hỏng thì component tự xử lý qua useQuery.
 */
export async function clientLoader({ params }: Route.LoaderArgs) {
  if (params.id) {
    await Promise.all([
      queryClient.prefetchQuery(courseBuilderQueryOptions(params.id)),
      queryClient.prefetchQuery(coursesListQueryOptions()),
    ]);
  }
  return null;
}

// Biên lỗi + tiêu đề theo route (cụm khung SSR #146, từ rà soát #133).
export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
export function meta() {
  return titleMeta('Xây dựng khoá học');
}
