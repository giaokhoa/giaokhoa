import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const API_TIMEOUT_MS = 30_000;

export function createApiClient(request: Request) {
  const cookie = request.headers.get('cookie');

  return axios.create({
    adapter: 'fetch',
    baseURL: API_URL,
    allowAbsoluteUrls: false,
    headers: cookie ? { cookie } : undefined,
    signal: request.signal,
    timeout: API_TIMEOUT_MS,
    transitional: { clarifyTimeoutError: true },
    redact: ['cookie', 'authorization'],
    validateStatus: () => true,
  });
}

export function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}
