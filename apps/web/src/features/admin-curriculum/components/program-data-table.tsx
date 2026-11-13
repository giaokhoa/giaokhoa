import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Button } from '@giaokhoa/ui/components/button';
import { DataTable, type DataColumn } from '#components/data-table';
import type {
  CurriculumOutcome, CurriculumTree, CurriculumTreeNode,
} from '#lib/curriculum';
import { flattenProgramRows, NodeRowActions, OutcomeContent, type ProgramRow } from './program-group-table';


export type ProgramOutcomeRow = {
  id: string;
  strandTitle: string | null;
  strandNode: CurriculumTreeNode | null;
  isGroupStart: boolean;
  node: CurriculumTreeNode;
  path: string[];
  outcome: CurriculumOutcome | null;
  isNodeStart: boolean;
};

export function buildProgramOutcomeRows(tree: CurriculumTree): ProgramOutcomeRow[] {
  const rows: ProgramOutcomeRow[] = [];
  for (const root of tree.nodes) {
    const strandTitle = root.kind === 'strand' ? root.title : null;
    const strandNode = root.kind === 'strand' ? root : null;
    const programRows: ProgramRow[] = [];
    if (root.kind === 'strand') {
      if (root.outcomes.length > 0) programRows.push({ node: root, path: [] });
      for (const child of root.children) flattenProgramRows(child, [], programRows);
    } else {
      flattenProgramRows(root, [], programRows);
    }
    let groupStartPending = true;
    const pushRow = (programRow: ProgramRow, outcome: CurriculumOutcome | null, isNodeStart: boolean) => {
      rows.push({
        id: `${programRow.node.id}::${outcome?.id ?? 'none'}`,
        strandTitle,
        strandNode,
        isGroupStart: groupStartPending,
        node: programRow.node,
        path: programRow.path,
        outcome,
        isNodeStart,
      });
      groupStartPending = false;
    };
    if (programRows.length === 0 && strandNode) {
      pushRow({ node: strandNode, path: [] }, null, true);
    }
    for (const programRow of programRows) {
      if (programRow.node.outcomes.length === 0) {
        pushRow(programRow, null, true);
      } else {
        programRow.node.outcomes.forEach((outcome, index) => {
          pushRow(programRow, outcome, index === 0);
        });
      }
    }
  }
  return rows;
}

export function ProgramDataTable({
  rows,
  curriculumId,
  onDeleteNode,
  onDeleteOutcome,
}: {
  rows: ProgramOutcomeRow[];
  curriculumId: string;
  onDeleteNode: (node: CurriculumTreeNode) => void;
  onDeleteOutcome: (node: CurriculumTreeNode, outcomeId: string) => void;
}) {
  const { t } = useTranslation('app');

  const columns: DataColumn<ProgramOutcomeRow>[] = [
    {
      id: 'strand',
      header: t('curriculumStrandTopicColumn'),
      sortValue: (row) => row.strandTitle ?? '',
      filterValue: (row) => row.strandTitle ?? '',
      cell: (row) => (
        <span className="block">
          {row.strandTitle ? (
            <span className="flex flex-wrap items-center gap-2">
              {row.strandNode ? (
                <Badge variant="default">{t(`curriculumKind_${row.strandNode.kind}`)}</Badge>
              ) : null}
              <span className="font-medium">{row.strandTitle}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          {row.isGroupStart && row.strandNode ? (
            <span className="mt-1 block">
              <NodeRowActions node={row.strandNode} curriculumId={curriculumId} onDeleteNode={onDeleteNode} />
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'content',
      header: t('curriculumContentColumn'),
      sortValue: (row) => row.node.title,
      filterValue: (row) => [...row.path, row.node.title].join(' '),
      cell: (row) => (
        <span className="block">
          {row.path.length > 0 ? (
            <span className="block text-xs text-muted-foreground">{row.path.join(' › ')}</span>
          ) : null}
          <span className="font-medium">{row.node.title}</span>
          {row.isNodeStart && row.node.id !== row.strandNode?.id ? (
            <span className="mt-1 block">
              <NodeRowActions node={row.node} curriculumId={curriculumId} onDeleteNode={onDeleteNode} />
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'outcome',
      header: t('curriculumOutcomesLabel'),
      sortValue: (row) => row.outcome?.content ?? '',
      filterValue: (row) => row.outcome?.content ?? '',
      cell: (row) =>
        row.outcome ? (
          <span className="flex flex-wrap items-start gap-2">
            <span aria-hidden="true" className="text-muted-foreground">–</span>
            <span className="min-w-0 flex-1">
              <OutcomeContent content={row.outcome.content} contentDoc={row.outcome.contentDoc} />
              {row.outcome.sourceRef ? (
                <span className="block text-xs text-muted-foreground">
                  {t('curriculumOutcomeSource', { source: row.outcome.sourceRef })}
                </span>
              ) : null}
            </span>
            <span className="flex gap-2">
              <Button type="button" variant="outline" size="sm" render={<Link to={`/admin/curriculum/outcomes/${row.outcome.id}/edit`} />}>
                {t('curriculumEdit')}
              </Button>
              <Button type="button" variant="destructive" size="sm" onClick={() => onDeleteOutcome(row.node, row.outcome!.id)}>
                {t('curriculumDelete')}
              </Button>
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <DataTable
      data={rows}
      columns={columns}
      labels={{
        columns: t('dashboard:tableColumns'),
        previous: t('dashboard:tablePrevious'),
        next: t('dashboard:tableNext'),
        empty: t('curriculumTableEmpty'),
        pageInfo: (page, pages) => t('dashboard:tablePageInfo', { page, pages }),
        filterPlaceholder: t('curriculumSearchPlaceholder'),
      }}
      getRowId={(row) => row.id}
    />
  );
}
