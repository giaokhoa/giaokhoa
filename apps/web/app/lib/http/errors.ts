import axios from 'axios';

export function getApiErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || !('message' in body)) return undefined;

  const message = body.message;
  if (typeof message === 'string') return message;
  if (!Array.isArray(message)) return undefined;

  const messages = message.flatMap((item) => {
    if (typeof item === 'string') return [item];
    if (item && typeof item === 'object' && 'message' in item && typeof item.message === 'string') {
      return [item.message];
    }
    return [];
  });

  return messages.length ? messages.join('; ') : undefined;
}

export function getRequestErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    return getApiErrorMessage(error.response?.data) ?? fallback;
  }
  return error instanceof Error ? error.message : fallback;
}
