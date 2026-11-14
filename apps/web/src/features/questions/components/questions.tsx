import 'katex/dist/katex.min.css';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { QuestionView } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { ErrorAlert } from '#components/error-alert';
import { useTranslation } from 'react-i18next';
import { BankAreaTabs } from './bank-area-tabs';
import { CategoryBrowser } from './category-browser';
import { DiscoveryPanel } from './discovery-panel';
import { SystemQuestionPublicationPanel } from './system-question-publication-panel';
import { SystemPublishedQuestionsPanel } from './system-published-questions-panel';
import { DossierQueuePanel } from './dossier-queue-panel';
import { MyMatricesPanel, SystemMatricesPanel } from './my-matrices-panel';
import { MyPapersPanel } from './my-papers-panel';
import { MyQuestionsPanel } from './my-questions-panel';
import { StimuliPanel } from './stimuli-panel';
import { SystemPapersPanel } from './system-papers-panel';
import { SystemSharedExamsPanel } from './system-shared-exams-panel';
import { PageHeader, PageShell } from '#components/page-shell';
import '#config/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { usePermissions } from '#lib/permissions';
import { queryKeys } from '#lib/query-keys';
import { queryKeys as questionsQueryKeys } from '../queries/keys';
import {
  questionAttributionQueryOptions,
  useBankDossiers,
  useBankExamContributions,
  useBankExams,
  useBankMatrices,
  useCategoryQuestions,
  useCategoryStimuli,
  useMyBankQuestions,
  useQuestionBanks,
  useQuestionCategories,
} from '../queries/questions';
import type { AttributionLite } from '../types/questions';
import { useCurriculumSubjects } from '#lib/curriculum';
import { type BankArea } from '../utils/shared';




export function QuestionsPage({ area = 'my-questions' }: { area?: BankArea }) {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const perms = usePermissions();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [qCategory, setQCategory] = useState('');
  const bankGate = perms.ready && perms.canUseQuestionBank;
  const categoriesQuery = useQuestionCategories(bankGate);
  const categories = categoriesQuery.data ?? [];
  const firstCategoryId = categoriesQuery.data?.[0]?.id;
  const questionsQuery = useCategoryQuestions(qCategory, bankGate);
  const questions = questionsQuery.data ?? [];
  const stimuliQuery = useCategoryStimuli(qCategory, bankGate);
  const stimuli = stimuliQuery.data ?? [];

  const loading = categoriesQuery.isPending;
  const loadError = categoriesQuery.isError
    ? t('questionBankLoadFailed')
    : stimuliQuery.isError
      ? t('stimulusLoadFailed')
      : null;
  const displayMessage = message ?? loadError;

  if (firstCategoryId && !qCategory) setQCategory(String(firstCategoryId));
  const banks = useQuestionBanks('question').data ?? [];
  const [attributions, setAttributions] = useState<Record<string, AttributionLite>>({});
  const matrixBanks = useQuestionBanks('matrix').data ?? [];
  const subjects = useCurriculumSubjects(true).data ?? [];

  const examBanks = useQuestionBanks('exam').data ?? [];
  const [systemExamBankId, setSystemExamBankId] = useState('');
  const examContributions = useBankExamContributions(systemExamBankId).data ?? [];
  const paperContributions = examContributions.filter(
    (c) => !c.sourceDossierId && (c.status === 'pending' || c.status === 'pending_board'),
  );
  const contributionBySourceDossierId = new Map(
    examContributions.filter((c) => c.sourceDossierId).map((c) => [c.sourceDossierId!, c]),
  );
  const bankDossiers = (useBankDossiers(systemExamBankId).data ?? []).filter((d) => {
    if (d.status !== 'pending' && d.status !== 'pending_board') return false;
    const linked = contributionBySourceDossierId.get(d.id);
    return !linked || linked.status === 'pending' || linked.status === 'pending_board';
  });


  const location = useLocation();
  const [lastNoticeKey, setLastNoticeKey] = useState<string | null>(null);
  if (lastNoticeKey !== location.key) {
    setLastNoticeKey(location.key);
    const notice = (location.state as { notice?: string } | null)?.notice;
    if (notice) setMessage(notice);
  }



  const personalBank = banks.find((b) => b.scope === 'personal');
  const sharedBanks = banks.filter((b) => b.scope !== 'personal');
  const myQuestionsQuery = useMyBankQuestions(personalBank);
  const myQuestions = myQuestionsQuery.data ?? [];

  const loadAttributionsFor = useCallback(async (views: QuestionView[]) => {
    const derived = views.filter(
      (v) => (v.question as { derivedFromQuestionId?: string | null }).derivedFromQuestionId,
    );
    const entries = await Promise.all(
      derived
        .filter((v) => !attributions[v.question.id])
        .map(async (v) => {
          try {
            const a = await queryClient.fetchQuery(questionAttributionQueryOptions(v.question.id));
            return [v.question.id, a] as const;
          } catch {
            return null;
          }
        }),
    );
    const loaded: (readonly [string, AttributionLite])[] = entries.filter((entry) => entry !== null);
    return loaded;
  }, [attributions, queryClient]);

  useEffect(() => {
    if (!myQuestionsQuery.data?.length) return;
    let active = true;
    void loadAttributionsFor(myQuestionsQuery.data).then((loaded) => {
      if (active && loaded.length > 0) {
        setAttributions((prev) => ({ ...prev, ...Object.fromEntries(loaded) }));
      }
    });
    return () => { active = false; };
  }, [myQuestionsQuery.data, loadAttributionsFor]);



  const personalMatrixBank = matrixBanks.find((b) => b.scope === 'personal');
  const sharedMatrixBanks = matrixBanks.filter((b) => b.scope !== 'personal');
  const myMatrices = useBankMatrices(personalMatrixBank?.id).data ?? [];


  const personalExamBank = examBanks.find((b) => b.scope === 'personal');
  const sharedExamBanks = examBanks.filter((b) => b.scope !== 'personal');
  const myPapers = useBankExams(personalExamBank?.id).data ?? [];



  const refreshBanks = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.questionBanks('question') });
    if (personalBank) void queryClient.invalidateQueries({ queryKey: questionsQueryKeys.myBankQuestions(personalBank.id) });
  };
  const refreshMatrixBanks = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.questionBanks('matrix') });
    if (personalMatrixBank) void queryClient.invalidateQueries({ queryKey: queryKeys.bankMatrices(personalMatrixBank.id) });
  };
  const refreshExamBanks = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.questionBanks('exam') });
    if (personalExamBank) void queryClient.invalidateQueries({ queryKey: questionsQueryKeys.bankExams(personalExamBank.id) });
    void queryClient.invalidateQueries({ queryKey: questionsQueryKeys.myDossiers });
  };
  const refreshSharedMatrices = (bankId: string) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.bankMatrices(bankId) });
    void queryClient.invalidateQueries({ queryKey: questionsQueryKeys.bankMatrixContributions(bankId) });
  };
  const refreshSystemPapers = (bankId: string) => {
    void queryClient.invalidateQueries({ queryKey: questionsQueryKeys.bankExams(bankId) });
    void queryClient.invalidateQueries({ queryKey: questionsQueryKeys.bankExamContributions(bankId) });
    void queryClient.invalidateQueries({ queryKey: questionsQueryKeys.bankDossiers(bankId) });
  };
  const refreshMyDossiers = () => {
    void queryClient.invalidateQueries({ queryKey: questionsQueryKeys.myDossiers });
  };
  const refreshCategoryQuestions = () => {
    void queryClient.invalidateQueries({ queryKey: questionsQueryKeys.categoryQuestions(qCategory) });
  };


  useEffect(() => {
    if (!questionsQuery.data) return;
    let active = true;
    void loadAttributionsFor(questionsQuery.data).then((loaded) => {
      if (active && loaded.length > 0) {
        setAttributions((prev) => ({ ...prev, ...Object.fromEntries(loaded) }));
      }
    });
    return () => { active = false; };
  }, [questionsQuery.data, loadAttributionsFor]);


  if (!perms.ready) {
    return (
      <main className="@container/main flex flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
        {t('loading')}
      </main>
    );
  }
  if (!perms.canUseQuestionBank) {
    return (
      <main className="@container/main flex flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('questionBank')}</CardTitle>
            <CardDescription>{t('questionBankForbidden')}</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  const isQuestionArea = area === 'my-questions' || area === 'stimuli';
  const headerTitle =
    area === 'my-exams' || area === 'system-exams'
      ? t('examBank')
      : area === 'my-matrices' || area === 'system-matrices'
        ? t('matrixBank')
        : t('questionBank');
  const headerDescription =
    area === 'my-exams'
      ? t('myExamBankDescription')
      : area === 'my-matrices'
        ? t('myMatrixBankDescription')
        : area.startsWith('system')
          ? t('systemBankDescription')
          : t('questionBankDescription');

  return (
    <PageShell width="full">
      <PageHeader
        title={headerTitle}
        description={headerDescription}
        actions={
          isQuestionArea ? (
            <>
              <Button type="button" variant="outline" render={<Link to="/questions/categories/new" />}>
                {t('newCategory')}
              </Button>
              <Button type="button" render={<Link to={`/questions/new?category=${qCategory}`} />}>
                {t('newQuestion')}
              </Button>
            </>
          ) : area === 'my-exams' ? (
            <Button
              type="button"
              disabled={!personalExamBank}
              onClick={() => personalExamBank && navigate(`/exams/new?bank=${personalExamBank.id}`)}
            >
              {t('newExam')}
            </Button>
          ) : area === 'my-matrices' ? (
            <>
              <Button type="button" onClick={() => navigate('/matrices/new')} disabled={!personalMatrixBank}>
                {t('newMatrix')}
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate('/matrices/import')}>
                {t('matrixImportFromFile')}
              </Button>
            </>
          ) : undefined
        }
      />
      <BankAreaTabs area={area} />
      {displayMessage ? (
        <ErrorAlert>
          {displayMessage}
        </ErrorAlert>
      ) : null}

      {area === 'my-questions' ? (
        <MyQuestionsPanel
          myQuestions={myQuestions}
          attributions={attributions}
          sharedBanks={sharedBanks}
          refreshBanks={refreshBanks}
          refreshCategoryQuestions={refreshCategoryQuestions}
          setMessage={setMessage}
        />
      ) : null}

      {area === 'my-matrices' ? (
        <MyMatricesPanel
          myMatrices={myMatrices}
          sharedMatrixBanks={sharedMatrixBanks}
          subjects={subjects}
          refreshMatrixBanks={refreshMatrixBanks}
          setMessage={setMessage}
        />
      ) : null}

      {area === 'my-exams' ? (
        <MyPapersPanel
          myPapers={myPapers}
          sharedExamBanks={sharedExamBanks}
          systemExamBankId={systemExamBankId}
          refreshExamBanks={refreshExamBanks}
          refreshSystemPapers={refreshSystemPapers}
          refreshMyDossiers={refreshMyDossiers}
          setMessage={setMessage}
        />
      ) : null}


      {area.startsWith('system') ? (
        <>
      <div className="space-y-6">
            {area === 'system-questions' ? (
              <>
                <SystemQuestionPublicationPanel />
                <SystemPublishedQuestionsPanel />
                <DiscoveryPanel
                  sharedBanks={sharedBanks}
                  refreshBanks={refreshBanks}
                  setMessage={setMessage}
                />
              </>
            ) : null}
            {area === 'system-exams' ? (
            <>
            <SystemSharedExamsPanel />
            <section id="system-papers" className="space-y-3 scroll-mt-24">
              <SystemPapersPanel
                systemExamBankId={systemExamBankId}
                setSystemExamBankId={setSystemExamBankId}
                sharedExamBanks={sharedExamBanks}
                paperContributions={paperContributions}
                refreshExamBanks={refreshExamBanks}
                refreshSystemPapers={refreshSystemPapers}
                setMessage={setMessage}
              />
              <DossierQueuePanel
                bankDossiers={bankDossiers}
                contributionBySourceDossierId={contributionBySourceDossierId}
                systemExamBankId={systemExamBankId}
                refreshSystemPapers={refreshSystemPapers}
                refreshMyDossiers={refreshMyDossiers}
                setMessage={setMessage}
              />
            </section>
            </>
            ) : null}
            {area === 'system-matrices' ? (
              <SystemMatricesPanel
                sharedMatrixBanks={sharedMatrixBanks}
                subjects={subjects}
                refreshMatrixBanks={refreshMatrixBanks}
                refreshSharedMatrices={refreshSharedMatrices}
                setMessage={setMessage}
              />
            ) : null}
      </div>
        </>
      ) : null}


      {isQuestionArea ? (
        <CategoryBrowser
          categories={categories}
          questions={questions}
          stimuli={stimuli}
          attributions={attributions}
          qCategory={qCategory}
          setQCategory={setQCategory}
          loading={loading}
          refreshBanks={refreshBanks}
          refreshCategoryQuestions={refreshCategoryQuestions}
          setMessage={setMessage}
        />
      ) : null}

      {area === 'stimuli' ? (
        <StimuliPanel stimuli={stimuli} qCategory={qCategory} setMessage={setMessage} />
      ) : null}
    </PageShell>
  );
}


export default QuestionsPage;
