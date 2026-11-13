import { useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@giaokhoa/ui/components/button';
import { ErrorAlert } from '#components/error-alert';
import { PageShell } from '#components/page-shell';
import { useCurriculumNode } from '#lib/curriculum';
import { FormScreen } from './form-screen';
import { NodeForm } from './node-form';

export function AdminNodeNewPage() {
  const { t } = useTranslation('app');
  const { curriculumId } = useParams();
  const [searchParams] = useSearchParams();
  if (!curriculumId) return null;
  return (
    <FormScreen title={t('curriculumCreateNode')} backTo={`/admin/curriculum/curricula/${curriculumId}`}>
      <NodeForm curriculumId={curriculumId} parentId={searchParams.get('parentId')} />
    </FormScreen>
  );
}

export function AdminNodeEditPage() {
  const { t } = useTranslation('app');
  const { nodeId } = useParams();
  // Đọc node qua TanStack Query (F-01 của rà soát #133); tải lỗi thì
  // hiện lỗi kèm nút thử lại, chưa có dữ liệu thì giữ trạng thái đang tải.
  const nodeQuery = useCurriculumNode(nodeId);
  const node = nodeQuery.data;
  if (nodeQuery.isError) {
    return (
      <PageShell width="narrow">
        <ErrorAlert variant="destructive" descriptionClassName="flex items-center justify-between gap-2">
          <span>{t('curriculumLoadFailed')}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void nodeQuery.refetch()}>
            {t('retry')}
          </Button>
        </ErrorAlert>
      </PageShell>
    );
  }
  if (!node) {
    return (
      <PageShell width="narrow">
        <p className="text-sm text-muted-foreground">{t('curriculumLoading')}</p>
      </PageShell>
    );
  }
  return (
    <FormScreen title={t('curriculumEditNode', { title: node.title })} backTo={`/admin/curriculum/curricula/${node.curriculumId}`}>
      <NodeForm curriculumId={node.curriculumId} initial={node} />
    </FormScreen>
  );
}
