import { useCallback, useRef, useState, type FormEvent } from 'react';
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
import { statusChoiceOf, type ItemStatusChoice } from '../utils/utils';

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
  const [fullName, setFullname] = useState('');
  const [shortName, setShortname] = useState('');
  const [courseCategory, setCourseCategory] = useState('');
  const [summary, setSummary] = useState('');
  const [courseVisible, setCourseVisible] = useState(true);
  const [isTemplate, setIsTemplate] = useState(false);
  const [startDate, setStartdate] = useState('');
  const [endDate, setEnddate] = useState('');
  const [newSectionName, setNewSectionName] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [sectionEdits, setSectionEdits] = useState<Record<string, { name: string; status: ItemStatusChoice; openAt: string }>>({});
  const [moduleEdits, setModuleEdits] = useState<Record<string, { name: string; status: ItemStatusChoice; openAt: string }>>({});
  const [moduleDrafts, setModuleDrafts] = useState<Record<string, { component: string; name: string }>>({});
  const [bankOpenSectionId, setBankOpenSectionId] = useState<string | null>(null);
  const [bankItems, setBankItems] = useState<LibraryItem[] | null>(null);
  const [bankQuery, setBankQuery] = useState('');
  const [bankLoadError, setBankLoadError] = useState<string | null>(null);
  const [bankBusyId, setBankBusyId] = useState<string | null>(null);
  const [availabilityDrafts, setAvailabilityDrafts] = useState<Record<string, unknown>>({});
  const [dragSectionId, setDragSectionId] = useState<string | null>(null);
  const [dragModule, setDragModule] = useState<{ sectionId: string; moduleId: string } | null>(null);
  const otherCourses = (useCoursesList().data ?? []).filter((c) => c.id !== courseId);
  const [importSourceId, setImportSourceId] = useState('');
  const importContent = useCourseContent(importSourceId).data ?? null;
  const [importSections, setImportSections] = useState<string[]>([]);
  const [importModules, setImportModules] = useState<string[]>([]);
  const [criteriaMethod, setCriteriaMethod] = useState(1);
  const [criteriaDraft, setCriteriaDraft] = useState<{ criteriaType: string; moduleInstance: string; date: string }[]>([]);

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
  const pendingExamRequest = useRef<Record<string, string>>({});
  const createAssignmentMutation = useCreateBuilderAssignment(courseId);
  const createModuleMutation = useCreateBuilderModule(courseId);
  const saveModuleMutation = useSaveBuilderModule(courseId);
  const deleteModuleMutation = useDeleteBuilderModule(courseId);
  const duplicateModuleMutation = useDuplicateBuilderModule(courseId);
  const importContentMutation = useImportBuilderContent(courseId);
  const saveCriteriaMutation = useSaveBuilderCriteria(courseId);
  const recalculateMutation = useRecalculateBuilderCompletion(courseId);

  const [previousImportSourceId, setPreviousImportSourceId] = useState(importSourceId);
  if (previousImportSourceId !== importSourceId) {
    setPreviousImportSourceId(importSourceId);
    setImportSections([]);
    setImportModules([]);
  }

  async function saveCourse(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      await saveCourseMutation.mutateAsync({
        fullName,
        shortName,
        category: courseCategory,
        summary,
        visible: courseVisible,
        isTemplate,
        startDate: startDate ? startDate : null,
        endDate: endDate ? endDate : null,
      });
      setMessage(t('courseSaved'));
    } catch {
      setMessage(t('courseSaveFailed'));
    }
  }

  async function createSection(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      await createSectionMutation.mutateAsync(newSectionName.trim() ? { name: newSectionName.trim() } : {});
      setNewSectionName('');
      setMessage(t('sectionCreated'));
    } catch {
      setMessage(t('sectionCreateFailed'));
    }
  }

  async function saveSection(sectionId: string) {
    const edit = sectionEdits[sectionId];
    if (!edit) return;
    setMessage(null);
    try {
      await saveSectionMutation.mutateAsync({
        sectionId,
        body: {
          name: edit.name,
          visible: edit.status !== 'draft',
          openAt: edit.status === 'scheduled' && edit.openAt ? new Date(`${edit.openAt}T00:00:00`).toISOString() : null,
        },
      });
      setMessage(t('sectionSaved'));
    } catch {
      setMessage(t('sectionSaveFailed'));
    }
  }

  async function deleteSection(sectionId: string, sectionName: string) {
    if (!window.confirm(t('confirmDeleteSection', { name: sectionName }))) return;
    setMessage(null);
    try {
      await deleteSectionMutation.mutateAsync(sectionId);
      setMessage(t('sectionDeleted'));
    } catch {
      setMessage(t('sectionDeleteFailed'));
    }
  }

  async function duplicateSection(sectionId: string) {
    setMessage(null);
    try {
      await duplicateSectionMutation.mutateAsync(sectionId);
      setMessage(t('builderDuplicated'));
    } catch {
      setMessage(t('builderDuplicateFailed'));
    }
  }

  async function reorderSections(orderedIds: string[]) {
    setMessage(null);
    try {
      await reorderSectionsMutation.mutateAsync(orderedIds);
    } catch {
      setMessage(t('builderReorderFailed'));
      await reload();
    }
  }

  async function reorderModules(sectionId: string, orderedIds: string[]) {
    setMessage(null);
    try {
      await reorderModulesMutation.mutateAsync({ sectionId, moduleIds: orderedIds });
    } catch {
      setMessage(t('builderReorderFailed'));
      await reload();
    }
  }

  async function createModule(event: FormEvent, sectionId: string) {
    event.preventDefault();
    const draft = moduleDrafts[sectionId] ?? { component: 'mod_page', name: '' };
    setMessage(null);
    try {
      if (draft.component === 'mod_quiz') {
        if (!draft.name.trim()) return;
        const requestKey = `${sectionId}:${draft.name.trim()}`;
        const requestId = pendingExamRequest.current[requestKey] ?? crypto.randomUUID();
        pendingExamRequest.current[requestKey] = requestId;
        const created = await createExamPinMutation.mutateAsync({ sectionId, name: draft.name.trim(), requestId });
        delete pendingExamRequest.current[requestKey];
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
    setMessage(null);
    try {
      await saveModuleMutation.mutateAsync({
        cmId,
        body: {
          name: edit.name,
          visible: edit.status !== 'draft',
          openAt: edit.status === 'scheduled' && edit.openAt ? new Date(`${edit.openAt}T00:00:00`).toISOString() : null,
        },
      });
      setMessage(t('moduleSaved'));
    } catch {
      setMessage(t('moduleSaveFailed'));
    }
  }

  async function deleteModule(cmId: string, moduleName: string) {
    if (!window.confirm(t('confirmDeleteModule', { name: moduleName }))) return;
    setMessage(null);
    try {
      await deleteModuleMutation.mutateAsync(cmId);
      setMessage(t('moduleDeleted'));
    } catch {
      setMessage(t('moduleDeleteFailed'));
    }
  }

  async function duplicateModule(cmId: string) {
    setMessage(null);
    try {
      await duplicateModuleMutation.mutateAsync(cmId);
      setMessage(t('builderDuplicated'));
    } catch {
      setMessage(t('builderDuplicateFailed'));
    }
  }

  async function saveSectionAvailability(sectionId: string) {
    setMessage(null);
    try {
      await saveSectionMutation.mutateAsync({
        sectionId,
        body: { availability: availabilityDrafts[`section:${sectionId}`] ?? null },
      });
      setMessage(t('availabilitySaved'));
    } catch {
      setMessage(t('availabilitySaveFailed'));
    }
  }

  async function saveModuleAvailability(cmId: string) {
    setMessage(null);
    try {
      await saveModuleMutation.mutateAsync({
        cmId,
        body: { availability: availabilityDrafts[`module:${cmId}`] ?? null },
      });
      setMessage(t('availabilitySaved'));
    } catch {
      setMessage(t('availabilitySaveFailed'));
    }
  }

  async function submitImport(event: FormEvent) {
    event.preventDefault();
    if (!importSourceId || (importSections.length === 0 && importModules.length === 0)) return;
    setMessage(null);
    try {
      await importContentMutation.mutateAsync({
        sourceCourseId: importSourceId,
        ...(importSections.length ? { sectionIds: importSections } : {}),
        ...(importModules.length ? { moduleIds: importModules } : {}),
      });
      setMessage(t('builderImported'));
      setImportSections([]);
      setImportModules([]);
    } catch {
      setMessage(t('builderImportFailed'));
    }
  }

  async function saveCriteria(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      await saveCriteriaMutation.mutateAsync({
        method: criteriaMethod,
        criteria: criteriaDraft.map((criterion) => ({
          criteriaType: criterion.criteriaType,
          ...(criterion.criteriaType === 'module' ? { moduleInstance: criterion.moduleInstance } : {}),
          ...(criterion.criteriaType === 'date' ? { date: criterion.date } : {}),
        })),
      });
      setMessage(t('completionCriteriaSaved'));
    } catch {
      setMessage(t('completionCriteriaSaveFailed'));
    }
  }

  async function recalculateCompletion() {
    setMessage(null);
    try {
      await recalculateMutation.mutateAsync();
      setMessage(t('recalculatedCompletion'));
    } catch {
      setMessage(t('recalculateFailed'));
    }
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
  const selectClass = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm';
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
        content={content}
        sections={sections}
        newSectionName={newSectionName}
        setNewSectionName={setNewSectionName}
        onCreateSection={createSection}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        dragSectionId={dragSectionId}
        setDragSectionId={setDragSectionId}
        dragModule={dragModule}
        setDragModule={setDragModule}
        sectionEdits={sectionEdits}
        setSectionEdits={setSectionEdits}
        moduleEdits={moduleEdits}
        setModuleEdits={setModuleEdits}
        moduleDrafts={moduleDrafts}
        setModuleDrafts={setModuleDrafts}
        onSaveSection={saveSection}
        onDeleteSection={deleteSection}
        onDuplicateSection={duplicateSection}
        onReorderSections={reorderSections}
        onReorderModules={reorderModules}
        onSaveModule={saveModule}
        onDeleteModule={deleteModule}
        onDuplicateModule={duplicateModule}
        onCreateModule={createModule}
        groups={groups}
        groupings={groupings}
        gradeItems={gradeItems}
        setAvailabilityDrafts={setAvailabilityDrafts}
        onSaveSectionAvailability={saveSectionAvailability}
        onSaveModuleAvailability={saveModuleAvailability}
        bankOpenSectionId={bankOpenSectionId}
        onToggleBankPanel={toggleBankPanel}
        bankQuery={bankQuery}
        setBankQuery={setBankQuery}
        bankLoadError={bankLoadError}
        bankItems={bankItems}
        bankFiltered={bankFiltered}
        bankBusyId={bankBusyId}
        onInsertFromBank={insertFromBank}
        selectClass={selectClass}
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
        selectClass={selectClass}
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
        selectClass={selectClass}
      />
    </main>
  );
}

export default CourseBuilderPage;

export async function clientLoader({ params }: { params: Record<string, string | undefined> }) {
  if (params.id) {
    await Promise.all([
      queryClient.prefetchQuery(courseBuilderQueryOptions(params.id)),
      queryClient.prefetchQuery(coursesListQueryOptions()),
    ]);
  }
  return null;
}

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { titleMeta } from '#lib/route-meta';
export function meta() {
  return titleMeta('Xây dựng khoá học');
}
