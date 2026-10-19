import { authContract } from '@giaokhoa/shared/http/auth';
import { redirect, useActionData, useNavigation } from 'react-router';
import { requireSession } from '#features/auth/api/session.server.js';
import { OnboardingForm } from '#features/auth/components/onboarding-form.js';
import { createApiClient, isSuccessStatus } from '#lib/http/api.server.js';
import { getApiErrorMessage } from '#lib/http/errors.js';
import type { Route } from './+types/onboarding';

function safeRedirectPath(value: string | null) {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/questions/new';
}

function readField(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const redirectTo = safeRedirectPath(new URL(request.url).searchParams.get('redirect'));

  if (session.user.name.trim()) throw redirect(redirectTo);

  return { redirectTo };
}

export async function action({ request }: Route.ActionArgs) {
  const session = await requireSession(request);
  const redirectTo = safeRedirectPath(new URL(request.url).searchParams.get('redirect'));

  if (session.user.name.trim()) throw redirect(redirectTo);

  const data = await request.formData();
  const parsedRequest = authContract.completeOnboarding.body.safeParse({
    lastName: readField(data, 'lastName'),
    firstName: readField(data, 'firstName'),
    password: readField(data, 'password'),
  });
  if (!parsedRequest.success) {
    return { error: parsedRequest.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ.' };
  }

  const response = await createApiClient(request).request<unknown>({
    url: authContract.completeOnboarding.path,
    method: authContract.completeOnboarding.method,
    data: parsedRequest.data,
  });

  if (!isSuccessStatus(response.status)) {
    return { error: getApiErrorMessage(response.data) ?? 'Không thể hoàn tất đăng ký.' };
  }

  const parsedResponse = authContract.completeOnboarding.responses[201].safeParse(response.data);
  if (!parsedResponse.success) {
    return { error: 'Phản hồi đăng ký không hợp lệ.' };
  }

  throw redirect(redirectTo);
}

export default function OnboardingPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  return (
    <OnboardingForm error={actionData?.error} submitting={navigation.state === 'submitting'} />
  );
}
