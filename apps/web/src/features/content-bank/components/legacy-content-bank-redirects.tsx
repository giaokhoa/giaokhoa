import { Navigate, useLocation, useParams } from 'react-router';


export function LegacyContentBankRedirect() {
  const location = useLocation();
  return <Navigate to={`/content-bank${location.search}`} replace />;
}

export function LegacyContentBankNewRedirect() {
  const location = useLocation();
  return <Navigate to={`/content-bank/new${location.search}`} replace />;
}

export function LegacyContentBankEditRedirect() {
  const { id } = useParams();
  const location = useLocation();
  return <Navigate to={`/content-bank/${id}/edit${location.search}`} replace />;
}
