import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@giaokhoa/ui/components/button';
import { Label } from '@giaokhoa/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@giaokhoa/ui/components/select';
import { ErrorAlert } from '#components/error-alert';
import { PageHeader, PageShell } from '#components/page-shell';
import { ApiError } from '#lib/api';
import { useAccessContexts } from '#lib/access';
import { queryClient } from '#lib/query-client';
import {
  curriculumTreeScopedQueryOptions,
  useCurriculumCurriculaScoped, useCurriculumSubjectsScoped, useCurriculumTreeScoped,
  useDeleteCurriculumNode, useDeleteCurriculumOutcome,
  type CurriculumTree, type CurriculumTreeNode,
} from '#lib/curriculum';
import { flattenProgramRows, type ProgramRow } from './program-group-table';
import { buildProgramOutcomeRows, ProgramDataTable } from './program-data-table';
import { errorText } from '../utils/shared';

export const PROGRAM_PAGE_SIZE = 10;

interface ProgramGroup {
  key: string;
  title: string | null;
  groupNode: CurriculumTreeNode | null;
  rows: ProgramRow[];
}

export function buildProgramGroups(tree: CurriculumTree): ProgramGroup[] {
  const groups: ProgramGroup[] = [];
  for (const root of tree.nodes) {
    const rows: ProgramRow[] = [];
    if (root.kind === 'strand') {
      if (root.outcomes.length > 0) rows.push({ node: root, path: [] });
      for (const child of root.children) flattenProgramRows(child, [], rows);
      groups.push({ key: root.id, title: root.title, groupNode: root, rows });
    } else {
      flattenProgramRows(root, [], rows);
      groups.push({ key: root.id, title: null, groupNode: null, rows });
    }
  }
  return groups;
}

export async function adminCurriculumTreePageClientLoader({ params }: { params: { curriculumId?: string } }) {
  if (params.curriculumId) {
    await queryClient
      .ensureQueryData(curriculumTreeScopedQueryOptions(params.curriculumId, undefined))
      .catch(() => undefined);
  }
  return null;
}

export function AdminCurriculumTreePage() {
  const { t } = useTranslation('app');
  const { curriculumId } = useParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState<string | null>(null);

  const treeQuery = useCurriculumTreeScoped(curriculumId ?? '', undefined, curriculumId !== undefined);
  const tree = treeQuery.data ?? null;
  const forbidden = treeQuery.error instanceof ApiError && treeQuery.error.problem.status === 403;
  const deleteNodeMutation = useDeleteCurriculumNode();
  const deleteOutcomeMutation = useDeleteCurriculumOutcome();

  const contextsQuery = useAccessContexts();
  const systemContextId = contextsQuery.data?.find((c) => c.contextLevel === 10)?.id ?? null;
  const subjectsQuery = useCurriculumSubjectsScoped(systemContextId);
  const subjects = useMemo(
    () => [...(subjectsQuery.data ?? [])].sort((a, b) => a.position - b.position),
    [subjectsQuery.data],
  );
  const [pickedSubjectId, setPickedSubjectId] = useState<string | null>(null);
  const selectorSubjectId = pickedSubjectId ?? tree?.subject.id ?? '';
  const curriculaQuery = useCurriculumCurriculaScoped(selectorSubjectId, undefined, selectorSubjectId !== '');
  const selectorCurricula = useMemo(
    () => [...(curriculaQuery.data ?? [])].sort((a, b) => a.grade - b.grade),
    [curriculaQuery.data],
  );

  useEffect(() => {
    if (!tree || !pickedSubjectId || pickedSubjectId === tree.subject.id) return;
    if (curriculaQuery.data === undefined) return;
    const target =
      selectorCurricula.find((c) => c.grade === tree.curriculum.grade) ?? selectorCurricula[0];
    if (target) navigate(`/admin/curriculum/curricula/${target.id}`);
  }, [pickedSubjectId, curriculaQuery.data, selectorCurricula, tree, navigate]);

  async function deleteNode(node: CurriculumTreeNode) {
    if (!window.confirm(t('curriculumConfirmDeleteNode', { title: node.title }))) return;
    try {
      await deleteNodeMutation.mutateAsync(node.id);
      setMessage(t('curriculumNodeDeleted'));
    } catch (err) {
      setMessage(errorText(err, t('curriculumDeleteFailed')));
    }
  }

  async function deleteOutcome(_node: CurriculumTreeNode, outcomeId: string) {
    if (!window.confirm(t('curriculumConfirmDeleteOutcome'))) return;
    try {
      await deleteOutcomeMutation.mutateAsync(outcomeId);
      setMessage(t('curriculumOutcomeDeleted'));
    } catch (err) {
      setMessage(errorText(err, t('curriculumDeleteFailed')));
    }
  }

  if (forbidden) {
    return (
      <PageShell>
        <ErrorAlert variant="destructive">
          {t('curriculumForbidden')}
        </ErrorAlert>
      </PageShell>
    );
  }
  if (!tree) {
    return (
      <PageShell>
        <p className="text-sm text-muted-foreground">{t('curriculumLoading')}</p>
      </PageShell>
    );
  }

  const rows = buildProgramOutcomeRows(tree);
  const gradeSelectValue =
    selectorSubjectId === tree.subject.id
      ? tree.curriculum.id
      : (selectorCurricula.find((c) => c.grade === tree.curriculum.grade)?.id ??
        selectorCurricula[0]?.id ??
        '');

  return (
    <PageShell>
      <PageHeader
        title={t('curriculumTreeTitle', { subject: tree.subject.name, grade: tree.curriculum.grade })}
        description={t('curriculumTreeDescription')}
      />
      {message ? (
        <ErrorAlert>
          {message}
        </ErrorAlert>
      ) : null}
      <div className="flex flex-wrap items-end gap-4">
        {subjects.length > 0 ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="curriculum-tree-subject">{t('curriculumSubjectPickerLabel')}</Label>
            <Select
              value={selectorSubjectId}
              onValueChange={(value) => {
                if (value) setPickedSubjectId(value);
              }}
            >
              <SelectTrigger id="curriculum-tree-subject" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {subjects.map((subject) => (
                  <SelectItem key={subject.id} value={subject.id}>
                    {subject.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {selectorCurricula.length > 0 ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="curriculum-tree-grade">{t('curriculumGradePickerLabel')}</Label>
            <Select
              value={gradeSelectValue}
              onValueChange={(value) => {
                if (value && value !== curriculumId) {
                  navigate(`/admin/curriculum/curricula/${value}`);
                }
              }}
            >
              <SelectTrigger id="curriculum-tree-grade" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {selectorCurricula.map((curriculum) => (
                  <SelectItem key={curriculum.id} value={curriculum.id}>
                    {t('curriculumGradeLabel', { grade: curriculum.grade })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
      <div>
        <Button type="button" render={<Link to={`/admin/curriculum/curricula/${tree.curriculum.id}/nodes/new`} />}>
          {t('curriculumAddRootNode')}
        </Button>{' '}
        <Link to="/admin/curriculum" className="text-sm underline">
          {t('curriculumBackToList')}
        </Link>
      </div>
      <ProgramDataTable
        rows={rows}
        curriculumId={tree.curriculum.id}
        onDeleteNode={(n) => void deleteNode(n)}
        onDeleteOutcome={(n, id) => void deleteOutcome(n, id)}
      />
    </PageShell>
  );
}
