import { replace } from 'react-router';

export function legacyQuizLoader(request: Request): Response {
  const url = new URL(request.url);
  const next = url.pathname.replace('/quizzes/', '/exams/');
  return replace(`${next}${url.search}`);
}

export default function LegacyQuizRedirect() {
  return null;
}
