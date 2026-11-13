import { Navigate, useLocation, useParams } from 'react-router';


export function legacyQuestionsTarget(search: string): string | null {
  const params = new URLSearchParams(search);
  const bank = params.get('bank');
  if (!bank) return null;
  const section = params.get('section');
  let target: string | null = null;
  if (bank === 'my-questions') {
    target = section === 'stimuli' ? '/questions/stimuli' : '/questions';
  } else if (bank === 'my-papers') {
    target = '/exams';
  } else if (bank === 'my-matrices') {
    target = '/matrices';
  } else if (bank === 'system') {
    target =
      section === 'papers'
        ? '/system-bank/exams'
        : section === 'matrices'
          ? '/system-bank/matrices'
          : '/system-bank/questions';
  }
  if (!target) return null;
  params.delete('bank');
  params.delete('section');
  const rest = params.toString();
  return rest ? `${target}?${rest}` : target;
}

export function SystemBankIndexRedirect() {
  return <Navigate to="/system-bank/questions" replace />;
}

export function LegacyMatrixNewRedirect() {
  return <Navigate to="/matrices/new" replace />;
}

export function LegacyMatrixEditRedirect() {
  const { matrixId } = useParams();
  return <Navigate to={`/matrices/${matrixId}/edit`} replace />;
}

export function LegacyExamPapersRedirect() {
  const location = useLocation();
  return <Navigate to={`/exams${location.search}`} replace />;
}

export function LegacyExamPaperNewRedirect() {
  const location = useLocation();
  return <Navigate to={`/exams/new${location.search}`} replace />;
}

export function LegacyExamPaperEditRedirect() {
  const { paperId } = useParams();
  const location = useLocation();
  return <Navigate to={`/exams/${paperId}/edit${location.search}`} replace />;
}

export function LegacySystemBankPapersRedirect() {
  return <Navigate to="/system-bank/exams" replace />;
}
