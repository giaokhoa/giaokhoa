import { describe, expect, it, vi } from 'vitest';
import { ExamsService } from '../src/exams/service.js';
import { ClientError } from '../src/common/client-error.js';

const ACTOR = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d22';
const EXAM = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d23';
const QUESTION = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d24';

function setup() {
  const repository = {
    create: vi.fn(),
    listOwned: vi.fn(),
    findOwned: vi.fn(),
    updateOwned: vi.fn(),
    createRevision: vi.fn(),
    listRevisions: vi.fn(),
    findRevision: vi.fn(),
  };
  const authorization = { assertAuthorized: vi.fn(async () => undefined) };
  const service = new ExamsService(repository as never, authorization as never);
  return { service, repository, authorization };
}

describe('Dịch vụ đề thi (ExamsService)', () => {
  it('chặn người thiếu quyền ngay trước khi tạo hoặc xem danh sách đề riêng', async () => {
    const { service, repository, authorization } = setup();
    authorization.assertAuthorized.mockRejectedValueOnce(
      new ClientError('forbidden', 'authorization_denied', 'Không có quyền'),
    );
    await expect(service.createExam(ACTOR, { title: 'Đề Toán' })).rejects.toMatchObject({
      kind: 'forbidden',
    });
    expect(repository.create).not.toHaveBeenCalled();
    expect(authorization.assertAuthorized).toHaveBeenCalledWith({
      actorId: ACTOR,
      capability: 'exam:create_own',
      context: { kind: 'system', resourceKey: 'giaokhoa' },
    });

    repository.listOwned.mockResolvedValue([]);
    await expect(service.listExams(ACTOR)).resolves.toEqual([]);
    expect(repository.listOwned).toHaveBeenCalledWith(ACTOR);
    expect(authorization.assertAuthorized).toHaveBeenCalledWith({
      actorId: ACTOR,
      capability: 'exam:manage_own',
      context: { kind: 'system', resourceKey: 'giaokhoa' },
    });
  });

  it('chỉ tra cứu và sửa đề theo người sở hữu, không tiết lộ đề của người khác', async () => {
    const { service, repository } = setup();
    await expect(service.getExam(ACTOR, EXAM)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'exam_not_found',
    });
    await expect(service.updateExam(ACTOR, EXAM, { title: 'Đề mới' })).rejects.toMatchObject({
      kind: 'not_found',
      code: 'exam_not_found',
    });
    expect(repository.findOwned).toHaveBeenCalledWith(EXAM, ACTOR);
    expect(repository.updateOwned).toHaveBeenCalledWith(EXAM, ACTOR, { title: 'Đề mới' });
    repository.findOwned.mockResolvedValue({ id: EXAM, title: 'Đề kín' });
    await expect(service.getExam(ACTOR, EXAM)).resolves.toMatchObject({ title: 'Đề kín' });
  });

  it('từ chối phiên bản đề rỗng, sai cấu trúc hoặc lặp câu hỏi trước khi ghi', async () => {
    const { service, repository, authorization } = setup();
    const sameQuestion = { questionId: QUESTION, version: 1 };
    for (const questions of [
      [],
      [sameQuestion, sameQuestion],
      [{ questionId: QUESTION, version: 0 }],
    ]) {
      await expect(service.createRevision(ACTOR, EXAM, { questions })).rejects.toMatchObject({
        kind: 'invalid',
        code: 'exam_revision_invalid',
      });
    }
    expect(repository.createRevision).not.toHaveBeenCalled();
    expect(authorization.assertAuthorized).toHaveBeenCalledTimes(3);
  });

  it('chỉ gửi danh sách câu hỏi hợp lệ cho kho dữ liệu và bảo vệ thứ tự phiên bản', async () => {
    const { service, repository } = setup();
    const secondQuestion = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d25';
    const questions = [
      { questionId: secondQuestion, version: 2 },
      { questionId: QUESTION, version: 1 },
    ];
    repository.createRevision.mockResolvedValue({ id: EXAM, revision: 1, questions: [] });
    await expect(service.createRevision(ACTOR, EXAM, { questions })).resolves.toMatchObject({
      revision: 1,
    });
    expect(repository.createRevision).toHaveBeenCalledWith(EXAM, ACTOR, { questions });
    repository.createRevision.mockResolvedValueOnce(undefined);
    await expect(service.createRevision(ACTOR, EXAM, { questions })).rejects.toMatchObject({
      kind: 'not_found',
      code: 'exam_not_found',
    });
  });

  it('phân biệt đề không tồn tại với phiên bản đề không tồn tại khi truy vấn lịch sử', async () => {
    const { service, repository, authorization } = setup();
    await expect(service.listRevisions(ACTOR, EXAM)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'exam_not_found',
    });
    await expect(service.getRevision(ACTOR, EXAM, 5)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'exam_revision_not_found',
    });
    repository.listRevisions.mockResolvedValue([]);
    repository.findRevision.mockResolvedValue({ examId: EXAM, revision: 1 });
    await expect(service.listRevisions(ACTOR, EXAM)).resolves.toEqual([]);
    await expect(service.getRevision(ACTOR, EXAM, 1)).resolves.toMatchObject({
      revision: 1,
    });
    expect(repository.listRevisions).toHaveBeenCalledWith(EXAM, ACTOR);
    expect(repository.findRevision).toHaveBeenLastCalledWith(EXAM, 1, ACTOR);
    expect(authorization.assertAuthorized).toHaveBeenCalledWith({
      actorId: ACTOR,
      capability: 'exam:manage_own',
      context: { kind: 'system', resourceKey: 'giaokhoa' },
    });
  });
});
