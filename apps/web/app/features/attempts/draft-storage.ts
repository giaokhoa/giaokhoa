export type AnswerDraft = {
  choiceId: string;
  statements: Record<string, boolean | undefined>;
  answer: string;
  essay: unknown;
  parts: Record<string, unknown>;
};

type StorageHost = Pick<Window, 'localStorage'>;
type StoredDraft = { draft: AnswerDraft; serverVersion?: string | null };

export function draftConflicts(local: StoredDraft, currentVersion: string | null) {
  return local.serverVersion !== currentVersion;
}

export function readDraft(host: StorageHost, key: string): StoredDraft | null {
  try {
    const raw = host.localStorage.getItem(key);
    if (!raw || raw.length > 1_000_000) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entry = value as Partial<StoredDraft> & Partial<AnswerDraft>;
    // Các bản nháp trước khi có version được coi là xung đột, không tự gửi lên máy chủ.
    const draft = entry.draft ?? entry;
    if (
      !draft ||
      typeof draft.choiceId !== 'string' ||
      typeof draft.answer !== 'string' ||
      !draft.statements ||
      typeof draft.statements !== 'object' ||
      Array.isArray(draft.statements) ||
      Object.values(draft.statements).some((part) => typeof part !== 'boolean') ||
      !draft.parts ||
      typeof draft.parts !== 'object' ||
      Array.isArray(draft.parts)
    )
      return null;
    if (
      entry.serverVersion !== undefined &&
      entry.serverVersion !== null &&
      typeof entry.serverVersion !== 'string'
    )
      return null;
    return { draft: draft as AnswerDraft, serverVersion: entry.serverVersion };
  } catch {
    return null;
  }
}

export function writeDraft(
  host: StorageHost,
  key: string,
  draft: AnswerDraft,
  serverVersion: string | null,
): boolean {
  try {
    const content = JSON.stringify({ draft, serverVersion });
    if (content.length > 1_000_000) return false;
    host.localStorage.setItem(key, content);
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(host: StorageHost, key: string) {
  try {
    host.localStorage.removeItem(key);
  } catch {
    // Lưu trữ trình duyệt có thể bị vô hiệu hóa.
  }
}

export function shouldClearDraft(finished: boolean, dirty: boolean, conflict: boolean) {
  return finished || (!dirty && !conflict);
}

export function shouldRestoreDraft(finished: boolean) {
  return !finished;
}

export function autosaveDelay(answer: string | null, failed: string | null, failures: number) {
  if (answer === null) return null;
  if (answer !== failed) return 1500;
  return [3000, 10000, 30000][failures - 1] ?? null;
}
