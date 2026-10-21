import { describe, expect, it, vi } from 'vitest';
import { CurriculumService } from '../src/curriculum/service.js';

const SUBJECT = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d22';
const CURRICULUM = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d23';
const OTHER_CURRICULUM = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d24';
const PARENT = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d25';
const NODE = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d26';
const OUTCOME = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d27';

function setup() {
  const repository = {
    listSubjects: vi.fn(),
    createSubject: vi.fn(),
    findSubject: vi.fn(),
    updateSubject: vi.fn(),
    deleteSubject: vi.fn(),
    listAllCurricula: vi.fn(),
    listCurricula: vi.fn(),
    createCurriculum: vi.fn(),
    findCurriculum: vi.fn(),
    findCurriculumBySubjectAndGrade: vi.fn(),
    updateCurriculum: vi.fn(),
    deleteCurriculum: vi.fn(),
    listNodes: vi.fn(),
    createNode: vi.fn(),
    findNode: vi.fn(),
    updateNode: vi.fn(),
    updateNodeTree: vi.fn(),
    deleteNode: vi.fn(),
    listOutcomes: vi.fn(),
    createOutcome: vi.fn(),
    findOutcome: vi.fn(),
    updateOutcome: vi.fn(),
    deleteOutcome: vi.fn(),
  };
  const service = new CurriculumService(repository as never);
  return { service, repository };
}

describe('Dịch vụ chương trình học (CurriculumService)', () => {
  it('không tạo chương trình nếu môn học không tồn tại và không trả danh sách của môn sai', async () => {
    const { service, repository } = setup();
    await expect(service.createCurriculum({ subjectId: SUBJECT, grade: 6 })).rejects.toMatchObject({
      kind: 'not_found',
      code: 'subject_not_found',
    });
    await expect(service.listCurricula(SUBJECT)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'subject_not_found',
    });
    expect(repository.createCurriculum).not.toHaveBeenCalled();
    expect(repository.listCurricula).not.toHaveBeenCalled();

    repository.findSubject.mockResolvedValue({ id: SUBJECT });
    repository.createCurriculum.mockResolvedValue({ id: CURRICULUM });
    await expect(service.createCurriculum({ subjectId: SUBJECT, grade: 6 })).resolves.toMatchObject(
      {
        id: CURRICULUM,
      },
    );
    expect(repository.createCurriculum).toHaveBeenCalledWith({ subjectId: SUBJECT, grade: 6 });
  });

  it('không tạo nút có cha không tồn tại hoặc cha thuộc chương trình khác', async () => {
    const { service, repository } = setup();
    repository.findCurriculum.mockResolvedValue({ id: CURRICULUM });
    const input = { curriculumId: CURRICULUM, title: 'Nút con', parentId: PARENT };
    await expect(service.createNode(input)).rejects.toMatchObject({
      kind: 'invalid',
      code: 'curriculum_parent_invalid',
    });
    repository.findNode.mockResolvedValue({ id: PARENT, curriculumId: OTHER_CURRICULUM });
    await expect(service.createNode(input)).rejects.toMatchObject({
      kind: 'invalid',
      code: 'curriculum_parent_invalid',
    });
    expect(repository.createNode).not.toHaveBeenCalled();
    repository.findNode.mockResolvedValue({ id: PARENT, curriculumId: CURRICULUM });
    repository.createNode.mockResolvedValue({ id: NODE, parentId: PARENT });
    await expect(service.createNode(input)).resolves.toMatchObject({
      id: NODE,
      parentId: PARENT,
    });
    expect(repository.createNode).toHaveBeenCalledWith(input);
  });

  it('không cho liệt kê nút của chương trình không tồn tại', async () => {
    const { service, repository } = setup();
    await expect(service.listNodes(CURRICULUM)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'curriculum_not_found',
    });
    expect(repository.listNodes).not.toHaveBeenCalled();
  });

  it('chỉ đổi thông tin nút qua đường thông thường khi không sửa quan hệ cha', async () => {
    const { service, repository } = setup();
    const patch = { title: 'Tên mới' };
    repository.findNode.mockResolvedValue({ id: NODE, curriculumId: CURRICULUM });
    repository.updateNode.mockResolvedValue({ id: NODE, title: patch.title });
    await expect(service.updateNode(NODE, patch)).resolves.toMatchObject({ title: patch.title });
    expect(repository.updateNode).toHaveBeenCalledWith(NODE, patch);
    expect(repository.updateNodeTree).not.toHaveBeenCalled();
    repository.updateNode.mockResolvedValueOnce(undefined);
    await expect(service.updateNode(NODE, patch)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'curriculum_node_not_found',
    });
  });

  it('mọi lần đổi cha phải qua thao tác bảo vệ cây, kể cả đưa nút lên gốc', async () => {
    const { service, repository } = setup();
    const updated = { id: NODE, parentId: null };
    repository.updateNodeTree.mockResolvedValue({ status: 'updated', node: updated });
    await expect(service.updateNode(NODE, { parentId: null })).resolves.toEqual(updated);
    expect(repository.updateNodeTree).toHaveBeenCalledWith(NODE, { parentId: null });
    expect(repository.updateNode).not.toHaveBeenCalled();
    expect(repository.findNode).not.toHaveBeenCalled();
  });

  it('phân biệt nút không tồn tại, cha không hợp lệ và chu trình để trả lỗi chính xác', async () => {
    const { service, repository } = setup();
    for (const [status, kind, code] of [
      ['not_found', 'not_found', 'curriculum_node_not_found'],
      ['invalid_parent', 'invalid', 'curriculum_parent_invalid'],
      ['cycle', 'invalid', 'curriculum_cycle'],
    ] as const) {
      repository.updateNodeTree.mockResolvedValueOnce({ status });
      await expect(service.updateNode(NODE, { parentId: PARENT })).rejects.toMatchObject({
        kind,
        code,
      });
    }
    expect(repository.updateNodeTree).toHaveBeenCalledTimes(3);
    expect(repository.updateNode).not.toHaveBeenCalled();
  });

  it('kiểm tra nút sở hữu yêu cầu cần đạt trước khi tạo hoặc đọc danh sách', async () => {
    const { service, repository } = setup();
    const data = { nodeId: NODE, content: 'Nhận biết số tự nhiên' };
    await expect(service.createOutcome(data)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'curriculum_node_not_found',
    });
    await expect(service.listOutcomes(NODE)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'curriculum_node_not_found',
    });
    expect(repository.createOutcome).not.toHaveBeenCalled();
    expect(repository.listOutcomes).not.toHaveBeenCalled();

    repository.findNode.mockResolvedValue({ id: NODE });
    repository.createOutcome.mockResolvedValue({ id: OUTCOME, ...data });
    await expect(service.createOutcome(data)).resolves.toMatchObject({ id: OUTCOME });
    expect(repository.createOutcome).toHaveBeenCalledWith(data);
  });

  it('đọc và sửa yêu cầu cần đạt phải phân biệt bản ghi không tồn tại', async () => {
    const { service, repository } = setup();
    await expect(service.updateOutcome(OUTCOME, { content: 'Mức mới' })).rejects.toMatchObject({
      kind: 'not_found',
      code: 'learning_outcome_not_found',
    });
    expect(repository.updateOutcome).not.toHaveBeenCalled();
    repository.findOutcome.mockResolvedValue({ id: OUTCOME, nodeId: NODE });
    repository.updateOutcome.mockResolvedValue(undefined);
    await expect(service.updateOutcome(OUTCOME, { content: 'Mức mới' })).rejects.toMatchObject({
      kind: 'not_found',
      code: 'learning_outcome_not_found',
    });
    repository.updateOutcome.mockResolvedValue({ id: OUTCOME, content: 'Mức mới' });
    await expect(service.updateOutcome(OUTCOME, { content: 'Mức mới' })).resolves.toMatchObject({
      content: 'Mức mới',
    });
    expect(repository.updateOutcome).toHaveBeenCalledWith(OUTCOME, { content: 'Mức mới' });
  });

  it('không chuyển chương trình sang môn không tồn tại và phân biệt thay đổi bị mất trong lúc ghi', async () => {
    const { service, repository } = setup();
    repository.findCurriculum.mockResolvedValue({ id: CURRICULUM, subjectId: SUBJECT });
    const patch = { subjectId: SUBJECT };
    await expect(service.updateCurriculum(CURRICULUM, patch)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'subject_not_found',
    });
    expect(repository.updateCurriculum).not.toHaveBeenCalled();

    repository.findSubject.mockResolvedValue({ id: SUBJECT });
    repository.updateCurriculum
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: CURRICULUM, subjectId: SUBJECT });
    await expect(service.updateCurriculum(CURRICULUM, patch)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'curriculum_not_found',
    });
    await expect(service.updateCurriculum(CURRICULUM, patch)).resolves.toMatchObject({
      subjectId: SUBJECT,
    });
    expect(repository.updateCurriculum).toHaveBeenCalledWith(CURRICULUM, patch);
  });
});
