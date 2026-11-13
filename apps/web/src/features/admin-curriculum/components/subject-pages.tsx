import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageShell } from '#components/page-shell';
import { useCurriculumSubjectRow } from '#lib/curriculum';
import { FormScreen } from './form-screen';
import { SubjectForm } from './subject-form';

export function AdminSubjectNewPage() {
  const { t } = useTranslation('app');
  return (
    <FormScreen title={t('curriculumCreateSubject')} backTo="/admin/curriculum">
      <SubjectForm />
    </FormScreen>
  );
}

export function AdminSubjectEditPage() {
  const { t } = useTranslation('app');
  const { subjectId } = useParams();
  const subjectQuery = useCurriculumSubjectRow(subjectId);
  const subject = subjectQuery.data;
  if (!subject) {
    return (
      <PageShell width="narrow">
        <p className="text-sm text-muted-foreground">{t('curriculumLoading')}</p>
      </PageShell>
    );
  }
  return (
    <FormScreen title={t('curriculumEditSubject', { name: subject.name })} backTo="/admin/curriculum">
      <SubjectForm initial={subject} subjectId={subject.id} />
    </FormScreen>
  );
}
