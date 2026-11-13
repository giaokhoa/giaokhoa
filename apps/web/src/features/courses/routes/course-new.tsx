import { useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { Course, CourseCategory, CourseCategoryTreeNode } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Input } from '@giaokhoa/ui/components/input';
import { Label } from '@giaokhoa/ui/components/label';
import { useTranslation } from 'react-i18next';
import '#config/i18n';
import { ClassPicker } from '../components/class-picker';
import { FrameUnitPicker } from '../components/frame-picker';
import { useAccessContexts } from '#lib/access';
import { useCurriculumFrameUnits, useCurriculumSubjectsScoped } from '#lib/curriculum';
import { courseNewPageClientLoader, useApplyCurriculumFrame, useCourseCategoryTree, useCourseList, useCourseTemplates, useCreateClassForWizard, useCreateCourse, useDuplicateCourse, useWizardClasses } from '../queries/course-new';

type WizardPath = 'frame' | 'book' | 'duplicate' | 'blank' | 'template';

const PATHS: { key: WizardPath; titleKey: string; descKey: string }[] = [
  { key: 'frame', titleKey: 'wizardPathFrame', descKey: 'wizardPathFrameDesc' },
  { key: 'book', titleKey: 'wizardPathBook', descKey: 'wizardPathBookDesc' },
  { key: 'duplicate', titleKey: 'wizardPathDuplicate', descKey: 'wizardPathDuplicateDesc' },
  { key: 'blank', titleKey: 'wizardPathBlank', descKey: 'wizardPathBlankDesc' },
  { key: 'template', titleKey: 'wizardPathTemplate', descKey: 'wizardPathTemplateDesc' },
];

export function CourseNewPage() {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const location = useLocation();
  const [path, setPath] = useState<WizardPath>('blank');
  const treeQuery = useCourseCategoryTree();
  const categories = useMemo(() => {
    const flat: CourseCategory[] = [];
    const walk = (nodes: CourseCategoryTreeNode[]) => {
      for (const n of nodes) {
        flat.push(n);
        walk(n.children);
      }
    };
    walk(treeQuery.data ?? []);
    return flat;
  }, [treeQuery.data]);
  const courses = useCourseList().data ?? [];
  const templates = useCourseTemplates().data ?? [];
  const classes = useWizardClasses().data ?? [];
  const contextsQuery = useAccessContexts();
  const systemContextId = contextsQuery.data?.find((c) => c.contextLevel === 10)?.id ?? null;
  const subjects = useCurriculumSubjectsScoped(systemContextId).data ?? [];
  const createCourse = useCreateCourse();
  const duplicateCourse = useDuplicateCourse();
  const applyFrame = useApplyCurriculumFrame();
  const createClassMutation = useCreateClassForWizard();
  const [fullName, setFullName] = useState('');
  const [shortName, setShortName] = useState('');
  const [categoryChoice, setCategoryChoice] = useState('');
  const category = categoryChoice || (categories.length > 0 ? String(categories[0]!.id) : '');
  const setCategory = setCategoryChoice;
  const [startDate, setStartDate] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [classChoice, setClassChoice] = useState<string | null>(null);
  const classPreselect = (() => {
    const wanted = new URLSearchParams(location.search).get('classId');
    if (wanted && classes.some((c) => c.id === wanted)) return wanted;
    return classes.find((c) => c.status === 'active')?.id ?? '';
  })();
  const classId = classChoice ?? classPreselect;
  const setClassId = setClassChoice;
  const [newClassName, setNewClassName] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [grade, setGrade] = useState('');
  const frameQuery = useCurriculumFrameUnits(subjectId, grade ? Number(grade) : null);
  const frameUnits = frameQuery.data?.units ?? [];
  const frameCurriculumId = frameQuery.data?.curriculumId ?? null;
  const [frameSelected, setFrameSelected] = useState<string[]>([]);

  const frameScope = subjectId + ':' + grade;
  const [previousFrameScope, setPreviousFrameScope] = useState(frameScope);
  if (frameScope !== previousFrameScope) {
    setPreviousFrameScope(frameScope);
    setFrameSelected([]);
  }

  function pickSource(course: Course | undefined) {
    if (!course) return;
    setFullName(`${course.fullName} ${t('wizardCopySuffix')}`);
    setShortName(`${course.shortName}-copy`);
    setCategory(course.category);
  }

  async function resolveClassId(): Promise<{ id: string } | { error: 'required' | 'createFailed' }> {
    if (classes.length > 0) return classId ? { id: classId } : { error: 'required' };
    if (!newClassName.trim()) return { error: 'required' };
    try {
      const created = await createClassMutation.mutateAsync({ name: newClassName.trim() });
      setClassId(created.id);
      return { id: created.id };
    } catch {
      return { error: 'createFailed' };
    }
  }

  async function goToBuilder(courseId: string) {
    await navigate(`/courses/${courseId}/builder`);
  }

  async function submitDuplicate(event: FormEvent) {
    event.preventDefault();
    const fromId = path === 'template' ? templateId : sourceId;
    if (!fromId) return;
    setBusy(true);
    setMessage(null);
    try {
      const resolved = await resolveClassId();
      let effectiveClassId: string | null = null;
      if ('id' in resolved) {
        effectiveClassId = resolved.id;
      } else if (path === 'duplicate' && classes.length === 0 && !newClassName.trim()) {
        effectiveClassId = null;
      } else {
        setMessage(t(resolved.error === 'createFailed' ? 'wizardClassCreateFailed' : 'wizardClassRequired'));
        setBusy(false);
        return;
      }
      const created = await duplicateCourse.mutateAsync({
        fromId,
        body: {
          fullName,
          shortName,
          ...(category ? { category } : {}),
          ...(startDate ? { startDate } : {}),
          ...(effectiveClassId ? { classId: effectiveClassId } : {}),
        },
      });
      await goToBuilder(created.id);
    } catch {
      setMessage(t('wizardCreateFailed'));
      setBusy(false);
    }
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const resolved = await resolveClassId();
      if ('error' in resolved) {
        setMessage(t(resolved.error === 'createFailed' ? 'wizardClassCreateFailed' : 'wizardClassRequired'));
        setBusy(false);
        return;
      }
      const effectiveClassId = resolved.id;
      const created = await createCourse.mutateAsync({
        fullName,
        shortName,
        category,
        classId: effectiveClassId,
        ...(startDate ? { startDate } : {}),
        ...(path === 'frame' && subjectId ? { subjectId } : {}),
        ...(path === 'frame' && grade ? { grade: Number(grade) } : {}),
      });
      if (path === 'frame' && frameCurriculumId && frameSelected.length > 0) {
        try {
          await applyFrame.mutateAsync({
            courseId: created.id,
            curriculumId: frameCurriculumId,
            nodeIds: frameSelected,
          });
        } catch {
          setMessage(t('courseCreatedFrameFailed'));
          setBusy(false);
          await goToBuilder(created.id);
          return;
        }
      }
      await goToBuilder(created.id);
    } catch {
      setMessage(t('wizardCreateFailed'));
      setBusy(false);
    }
  }

  const selectClass = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm';
  const isDuplicatePath = path === 'duplicate' || path === 'template';

  return (
    <main className="@container/main flex flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('wizardTitle')}</CardTitle>
          <CardDescription>{t('wizardDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 md:grid-cols-2" role="radiogroup" aria-label={t('wizardTitle')}>
            {PATHS.map((p) => (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={path === p.key}
                data-testid={`wizard-path-${p.key}`}
                onClick={() => setPath(p.key)}
                className={`rounded border p-3 text-left ${path === p.key ? 'border-primary bg-accent' : ''}`}
              >
                <span className="block font-medium">{t(p.titleKey)}</span>
                <span className="block text-sm text-muted-foreground">{t(p.descKey)}</span>
              </button>
            ))}
          </div>

          {path === 'book' ? (
            <div className="space-y-3" data-testid="wizard-book-panel">
              <p className="text-sm">{t('wizardBookPending')}</p>
              <Button type="button" variant="outline" onClick={() => setPath('frame')}>
                {t('wizardUseFrameInstead')}
              </Button>
            </div>
          ) : (
            <form onSubmit={isDuplicatePath ? submitDuplicate : submitCreate} className="space-y-3">
              {path === 'duplicate' ? (
                <div className="space-y-2">
                  <Label htmlFor="wizard-source">{t('wizardSourceCourse')}</Label>
                  <select
                    id="wizard-source"
                    className={selectClass}
                    value={sourceId}
                    onChange={(e) => {
                      setSourceId(e.target.value);
                      pickSource(courses.find((c) => c.id === e.target.value));
                    }}
                  >
                    <option value="">{t('wizardPickSource')}</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName} ({c.shortName})
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {path === 'template' ? (
                <div className="space-y-2">
                  <Label htmlFor="wizard-template">{t('wizardTemplateCourse')}</Label>
                  <select
                    id="wizard-template"
                    className={selectClass}
                    value={templateId}
                    onChange={(e) => {
                      setTemplateId(e.target.value);
                      pickSource(templates.find((c) => c.id === e.target.value));
                    }}
                  >
                    <option value="">{t('wizardPickTemplate')}</option>
                    {templates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName} ({c.shortName})
                      </option>
                    ))}
                  </select>
                  {templates.length === 0 ? <p className="text-sm text-muted-foreground">{t('wizardNoTemplates')}</p> : null}
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="wizard-fullname">{t('courseFullName')}</Label>
                <Input id="wizard-fullname" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wizard-shortname">{t('courseShortName')}</Label>
                <Input id="wizard-shortname" value={shortName} onChange={(e) => setShortName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wizard-category">{t('courseCategory')}</Label>
                <select id="wizard-category" className={selectClass} value={category} onChange={(e) => setCategory(e.target.value)}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="wizard-class">{t('wizardClass')}</Label>
                  {classes.length > 0 ? (
                    <ClassPicker
                      id="wizard-class"
                      className={selectClass}
                      classes={classes}
                      value={classId}
                      onChange={setClassId}
                      emptyLabel={t('wizardClassPick')}
                    />
                  ) : (
                    <>
                      <Input
                        id="wizard-class"
                        aria-label={t('wizardClassNewName')}
                        value={newClassName}
                        onChange={(e) => setNewClassName(e.target.value)}
                        placeholder={t('wizardClassNewName')}
                      />
                      <p className="text-sm text-muted-foreground">{t('wizardClassStepHint')}</p>
                    </>
                  )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="wizard-startdate">{t('courseStartDate')}</Label>
                <Input id="wizard-startdate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                {isDuplicatePath ? <p className="text-sm text-muted-foreground">{t('wizardStartDateHint')}</p> : null}
              </div>
              {path === 'frame' ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="wizard-subject">{t('courseSubject')}</Label>
                    <select id="wizard-subject" className={selectClass} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                      <option value="">{t('courseSubjectNone')}</option>
                      {subjects.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="wizard-grade">{t('courseGrade')}</Label>
                    <select id="wizard-grade" className={selectClass} value={grade} onChange={(e) => setGrade(e.target.value)}>
                      <option value="">{t('courseGradeNone')}</option>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((g) => (
                        <option key={g} value={g}>
                          {t('curriculumGradeLabel', { grade: g })}
                        </option>
                      ))}
                    </select>
                  </div>
                  {frameCurriculumId ? (
                    <div className="space-y-2">
                      <Label>{t('courseFrameUnitsTitle')}</Label>
                      <FrameUnitPicker
                        units={frameUnits}
                        selected={frameSelected}
                        idPrefix="wizard-frame"
                        onToggle={(nodeId, checked) =>
                          setFrameSelected((prev) => (checked ? [...prev, nodeId] : prev.filter((id) => id !== nodeId)))
                        }
                      />
                    </div>
                  ) : null}
                </>
              ) : null}
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || (isDuplicatePath && !(path === 'template' ? templateId : sourceId))}>
                  {t('wizardCreateAndBuild')}
                </Button>
                <Link className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-transparent px-4 text-sm font-medium" to="/courses">{t('wizardBackToCourses')}</Link>
              </div>
            </form>
          )}
          {message ? (
            <p role="status" className="text-sm">
              {message}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}

export default CourseNewPage;

export async function clientLoader() {
  await courseNewPageClientLoader();
  return null;
}

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { titleMeta } from '#lib/route-meta';
export function meta() {
  return titleMeta('Tạo khoá học');
}
