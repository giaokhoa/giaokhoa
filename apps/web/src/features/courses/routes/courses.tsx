import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { CourseCategory, CourseCategoryTreeNode } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Empty, EmptyHeader, EmptyTitle } from '@giaokhoa/ui/components/empty';
import { Field, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@giaokhoa/ui/components/select';
import { PageSkeleton } from '#components/page-skeleton';
import { ErrorAlert } from '#components/error-alert';
import { useTranslation } from 'react-i18next';
import { PageHeader, PageShell } from '#components/page-shell';
import '#config/i18n';
import { usePermissions } from '#lib/permissions';
import { categoryTreeQueryOptions, courseMyProgressQueryOptions, coursesListQueryOptions, coursesPageClientLoader, useCreateCourseCategory, useDeleteCourseCategory, useRenameCourseCategory } from '../queries/courses';
import {
  COURSE_CARD_COLOR_HEX,
  displayCourseName,
  useCourseCardPrefs,
  type CourseCardPrefView,
} from '#lib/course-cards';

const EMPTY_CARD_PREFS = new Map<string, CourseCardPrefView>();
import { CourseCardPrefEditor } from '../components/course-card-pref-editor';

export function CoursesPage() {
  const { t } = useTranslation('app');
  const perms = usePermissions();
  const { canAdminister } = perms;
  const treeQuery = useQuery(categoryTreeQueryOptions());
  const tree = useMemo(() => treeQuery.data ?? [], [treeQuery.data]);
  const coursesQuery = useQuery(coursesListQueryOptions());
  const courses = useMemo(() => coursesQuery.data ?? [], [coursesQuery.data]);
  const cardPrefsQuery = useCourseCardPrefs();
  const cardPrefs = cardPrefsQuery.data ?? EMPTY_CARD_PREFS;
  const [editingCardCourseId, setEditingCardCourseId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [catName, setCatName] = useState('');
  const [catParent, setCatParent] = useState('0');
  const [catEdits, setCatEdits] = useState<Record<string, string>>({});
  const loadError = coursesQuery.isError || treeQuery.isError ? t('coursesLoadFailed') : null;
  const displayMessage = message ?? loadError;

  const loading = treeQuery.isPending || coursesQuery.isPending;

  const memberCourseIds = useMemo(
    () => new Set([...perms.teaching, ...perms.learning].map((c) => c.course.id)),
    [perms.teaching, perms.learning],
  );
  const progressTargets = useMemo(
    () => (perms.ready ? courses.filter((c) => memberCourseIds.has(c.id)).map((c) => c.id) : []),
    [courses, memberCourseIds, perms.ready],
  );
  const progressQueries = useQueries({
    queries: progressTargets.map((courseId) => courseMyProgressQueryOptions(courseId)),
  });
  const progressByCourse: Record<string, number | null> = {};
  progressTargets.forEach((courseId, i) => {
    progressByCourse[courseId] = progressQueries[i]?.data?.percent ?? null;
  });

  const flatCategories: CourseCategory[] = [];
  const walk = (nodes: CourseCategoryTreeNode[]) => {
    for (const n of nodes) {
      flatCategories.push(n);
      walk(n.children);
    }
  };
  walk(tree);

  function renderTree(nodes: CourseCategoryTreeNode[], nested = false) {
    return (
      <ul className={nested ? 'ml-4 list-disc' : 'list-disc'}>
        {nodes.map((node) => {
          const nodeCourses = courses.filter((c) => c.category === node.id);
          return (
            <li key={node.id}>
              <span>{node.name}</span>
              {nodeCourses.length > 0 ? (
                <ul className="ml-4 list-disc">
                  {nodeCourses.map((c) => {
                    const pref = cardPrefs.get(c.id);
                    return (
                      <li key={c.id}>
                        {pref?.color ? (
                          <span
                            className="mr-1 inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: COURSE_CARD_COLOR_HEX[pref.color] }}
                            data-testid="course-card-color-dot"
                          />
                        ) : null}
                        <Link to={`/courses/${c.id}`} title={c.fullName}>
                          {displayCourseName(pref, c.fullName)} ({c.shortName})
                        </Link>
                        {!c.visible && <span> {t('hiddenSuffix')}</span>}
                        {progressByCourse[c.id] != null ? (
                          <span className="ml-2 text-sm text-muted-foreground">
                            {t('courseProgressLabel', { percent: progressByCourse[c.id]! })}
                          </span>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-1"
                          data-testid="course-card-edit"
                          onClick={() => setEditingCardCourseId(editingCardCourseId === c.id ? null : c.id)}
                        >
                          {t('cardPrefEdit')}
                        </Button>
                        {editingCardCourseId === c.id && (
                          <CourseCardPrefEditor
                            courseId={c.id}
                            initial={pref}
                            onSaved={() => setEditingCardCourseId(null)}
                            onCancel={() => setEditingCardCourseId(null)}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {node.children.length > 0 && renderTree(node.children, true)}
            </li>
          );
        })}
      </ul>
    );
  }

  const createCategoryMutation = useCreateCourseCategory();
  const renameCategoryMutation = useRenameCourseCategory();
  const deleteCategoryMutation = useDeleteCourseCategory();

  async function createCategory(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      await createCategoryMutation.mutateAsync({
        name: catName,
        ...(catParent && catParent !== '0' ? { parent: catParent } : {}),
      });
      setCatName('');
      setMessage(t('categoryCreated'));
    } catch {
      setMessage(t('categoryCreateFailed'));
    }
  }

  async function renameCategory(cat: CourseCategory) {
    const name = catEdits[cat.id] ?? cat.name;
    setMessage(null);
    try {
      await renameCategoryMutation.mutateAsync({ categoryId: cat.id, name });
      setMessage(t('categoryUpdated'));
    } catch {
      setMessage(t('categoryUpdateFailed'));
    }
  }

  async function deleteCategory(cat: CourseCategory) {
    if (!window.confirm(t('confirmDeleteCategory', { name: cat.name }))) return;
    setMessage(null);
    try {
      await deleteCategoryMutation.mutateAsync(cat.id);
      setMessage(t('categoryDeleted'));
    } catch {
      setMessage(t('categoryDeleteFailed'));
    }
  }

  return (
    <PageShell width="wide">
      <PageHeader title={t('coursesHeading')} />
      <Card>
        <CardHeader>
          <CardTitle>{t('courseCategories')}</CardTitle>
          <CardDescription>{t('courseCategoriesDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <PageSkeleton label={t('loading')} rows={['h-5 w-56', 'h-5 w-72', 'h-5 w-48']} />
          ) : tree.length === 0 ? (
            <Empty className="p-6">
              <EmptyHeader>
                <EmptyTitle>{t('noCategories')}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            renderTree(tree)
          )}
        </CardContent>
      </Card>

      {displayMessage ? (
        <ErrorAlert>
          {displayMessage}
        </ErrorAlert>
      ) : null}

      {canAdminister && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('categoryAdminTitle')}</CardTitle>
              <CardDescription>{t('categoryAdminDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-4">
                {flatCategories.map((cat) => (
                  <li key={cat.id} data-testid={`category-admin-${cat.id}`} className="space-y-2 rounded border p-3">
                    <p className="font-medium">{cat.name}</p>
                    <Field>
                      <FieldLabel htmlFor={`cat-rename-${cat.id}`}>{t('renameCategory')}</FieldLabel>
                      <Input
                        id={`cat-rename-${cat.id}`}
                        value={catEdits[cat.id] ?? cat.name}
                        onChange={(e) => setCatEdits((prev) => ({ ...prev, [cat.id]: e.target.value }))}
                      />
                    </Field>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={() => void renameCategory(cat)}>
                        {t('saveCategory')}
                      </Button>
                      <Button type="button" variant="destructive" onClick={() => void deleteCategory(cat)}>
                        {t('deleteCategory')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('createCategory')}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={createCategory}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="cat-name">{t('categoryName')}</FieldLabel>
                    <Input id="cat-name" value={catName} onChange={(e) => setCatName(e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel id="cat-parent-label">{t('parentCategory')}</FieldLabel>
                    <Select
                      items={Object.fromEntries([
                        ['0', t('topLevel')],
                        ...flatCategories.map((c) => [c.id, c.name] as [string, string]),
                      ])}
                      value={catParent}
                      onValueChange={(v) => setCatParent(v ?? '0')}
                    >
                      <SelectTrigger aria-labelledby="cat-parent-label" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">{t('topLevel')}</SelectItem>
                        {flatCategories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <div className="flex justify-end">
                    <Button type="submit">{t('createCategory')}</Button>
                  </div>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('createCourse')}</CardTitle>
              <CardDescription>{t('wizardListHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Link className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" to="/courses/new">{t('wizardOpen')}</Link>
            </CardContent>
          </Card>
        </>
      )}
    </PageShell>
  );
}

export async function clientLoader() {
  return coursesPageClientLoader();
}

export default CoursesPage;

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('navCourses');
}
