import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Button } from '@giaokhoa/ui/components/button';
import type { CurriculumTreeNode } from '#lib/curriculum';

export interface ProgramRow {
  node: CurriculumTreeNode;
  path: string[];
}

export function flattenProgramRows(node: CurriculumTreeNode, path: string[], out: ProgramRow[]): void {
  if (node.kind === 'lesson' || node.outcomes.length > 0) out.push({ node, path });
  for (const child of node.children) flattenProgramRows(child, [...path, node.title], out);
}

export function NodeRowActions({
  node, curriculumId, onDeleteNode,
}: {
  node: CurriculumTreeNode;
  curriculumId: string;
  onDeleteNode: (node: CurriculumTreeNode) => void;
}) {
  const { t } = useTranslation('app');
  return (
    <span className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" render={<Link to={`/admin/curriculum/curricula/${curriculumId}/nodes/new?parentId=${node.id}`} />}>
        {t('curriculumAddChildNode')}
      </Button>
      <Button type="button" variant="outline" size="sm" render={<Link to={`/admin/curriculum/nodes/${node.id}/outcomes/new`} />}>
        {t('curriculumAddOutcome')}
      </Button>
      <Button type="button" variant="outline" size="sm" render={<Link to={`/admin/curriculum/nodes/${node.id}/edit`} />}>
        {t('curriculumEdit')}
      </Button>
      <Button type="button" variant="destructive" size="sm" onClick={() => onDeleteNode(node)}>
        {t('curriculumDelete')}
      </Button>
    </span>
  );
}

export function OutcomeContent({
  content,
  contentDoc,
}: {
  content: string;
  contentDoc?: import('#lib/curriculum').CurriculumOutcomeDoc;
}) {
  if (contentDoc?.content) {
    return (
      <span>
        {contentDoc.content.map((node, index) => (
          <OutcomeDocNode key={index} node={node} />
        ))}
      </span>
    );
  }
  if (!content.includes('\n')) return <span>{content}</span>;
  return (
    <span>
      {content.split('\n').map((line, index) => (
        <span key={index} className="block">
          {line}
        </span>
      ))}
    </span>
  );
}

function OutcomeDocNode({
  node,
}: {
  node: import('#lib/curriculum').CurriculumOutcomeDocNode;
}) {
  if (node.type === 'paragraph') {
    const text = (node.content ?? [])
      .filter((child) => child.type === 'text')
      .map((child) => child.text ?? '')
      .join('');
    return <span className="block">{text}</span>;
  }
  if (node.type === 'listItem') {
    const children = node.content ?? [];
    const ownText = children
      .filter((child) => child.type === 'paragraph')
      .map((child) =>
        (child.content ?? [])
          .filter((grandchild) => grandchild.type === 'text')
          .map((grandchild) => grandchild.text ?? '')
          .join(''),
      )
      .join('');
    const nested = children.filter((child) => child.type !== 'paragraph');
    return (
      <span className="block pl-4">
        <span aria-hidden="true" className="text-muted-foreground">• </span>
        <span>{ownText}</span>
        {nested.map((child, index) => (
          <OutcomeDocNode key={index} node={child} />
        ))}
      </span>
    );
  }
  if (node.type === 'bulletList') {
    return (
      <span className="block">
        {(node.content ?? []).map((child, index) => (
          <OutcomeDocNode key={index} node={child} />
        ))}
      </span>
    );
  }
  return null;
}

export function ProgramGroupTable({
  title, groupNode, rows, curriculumId, onDeleteNode, onDeleteOutcome, continued = false, readOnly = false,
}: {
  title: string | null;
  groupNode: CurriculumTreeNode | null;
  rows: ProgramRow[];
  curriculumId: string;
  onDeleteNode?: (node: CurriculumTreeNode) => void;
  onDeleteOutcome?: (node: CurriculumTreeNode, outcomeId: string) => void;
  continued?: boolean;
  readOnly?: boolean;
}) {
  const { t } = useTranslation('app');
  return (
    <section className="overflow-hidden rounded border">
      {title !== null && groupNode ? (
        <header className="flex flex-wrap items-center gap-2 border-b bg-muted/40 p-3">
          <Badge variant="default">{t(`curriculumKind_${groupNode.kind}`)}</Badge>
          <h3 className="font-semibold">{title}</h3>
          {continued ? <span className="text-sm text-muted-foreground">{t('curriculumGroupContinued')}</span> : null}
          {!readOnly && onDeleteNode ? (
            <span className="ml-auto">
              <NodeRowActions node={groupNode} curriculumId={curriculumId} onDeleteNode={onDeleteNode} />
            </span>
          ) : null}
        </header>
      ) : null}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="w-1/2 p-2 font-medium">{t('curriculumContentColumn')}</th>
            <th className="p-2 font-medium">{t('curriculumOutcomesLabel')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ node, path }) => (
            <tr key={node.id} className="border-b align-top last:border-0">
              <td className="p-2">
                {path.length > 0 ? (
                  <span className="block text-xs text-muted-foreground">{path.join(' › ')}</span>
                ) : null}
                <span className="font-medium">{node.title}</span>
                {!readOnly && onDeleteNode ? (
                  <span className="mt-1 block">
                    <NodeRowActions node={node} curriculumId={curriculumId} onDeleteNode={onDeleteNode} />
                  </span>
                ) : null}
              </td>
              <td className="p-2">
                {node.outcomes.length === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {node.outcomes.map((outcome) => (
                      <li key={outcome.id} className="flex flex-wrap items-start gap-2">
                        <span aria-hidden="true" className="text-muted-foreground">–</span>
                        <span className="min-w-0 flex-1">
                          <OutcomeContent content={outcome.content} contentDoc={outcome.contentDoc} />
                          {outcome.sourceRef ? (
                            <span className="block text-xs text-muted-foreground">
                              {t('curriculumOutcomeSource', { source: outcome.sourceRef })}
                            </span>
                          ) : null}
                        </span>
                        {!readOnly && onDeleteOutcome ? (
                          <span className="flex gap-2">
                            <Button type="button" variant="outline" size="sm" render={<Link to={`/admin/curriculum/outcomes/${outcome.id}/edit`} />}>
                              {t('curriculumEdit')}
                            </Button>
                            <Button type="button" variant="destructive" size="sm" onClick={() => onDeleteOutcome(node, outcome.id)}>
                              {t('curriculumDelete')}
                            </Button>
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
