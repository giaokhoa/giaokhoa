import { authorizationContract } from '@giaokhoa/shared/http/authorization';
import { requireSession } from '#features/auth/api/session.server.js';
import { apiData } from '#lib/http/data.server.js';
import { systemCapabilities } from './access.js';

type Context = { kind: 'system' | 'class' | 'assignment'; resourceKey: string };
export async function getAccess(
  request: Request,
  context: Context = { kind: 'system', resourceKey: 'giaokhoa' },
  capabilities = systemCapabilities,
) {
  const session = await requireSession(request);
  const access = await apiData(
    request,
    authorizationContract.check.path,
    authorizationContract.check.responses[200],
    { method: 'POST', data: { context, capabilities } },
  );
  return { ...access, user: session.user };
}

export async function requireCapability(request: Request, capability: string, context?: Context) {
  const access = await getAccess(request, context, [capability]);
  if (!access.capabilities.includes(capability))
    throw new Response('Bạn không có quyền truy cập chức năng này.', { status: 403 });
  return access;
}
