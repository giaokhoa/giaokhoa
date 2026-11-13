import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemMaterialPackage, SystemMaterialSubmission, SystemMaterialVersion } from '@giaokhoa/contracts';
import '#config/i18n';
import { SystemMaterialsPanel } from './system-materials-panel';
import { materialSources, materialSubmissions, publishedMaterials, reviewMaterial, submitMaterial, attachPublishedMaterial } from '../api/system-materials';

const state = vi.hoisted(() => ({ role: 'teacher' }));
vi.mock('#lib/permissions', () => ({
  usePermissions: () => ({
    ready: true,
    access: { isSiteAdmin: false, contexts: [{ contextLevel: state.role === 'manager' ? 20 : 10,
      capabilities: state.role === 'manager' ? ['tenant:manage'] : state.role === 'editor' ? ['systembank:review'] : state.role === 'teacher' ? ['contentbank:upload'] : [],
    }] },
    courses: [{ course: { id: 'course-b', fullName: 'Khoá B' }, capabilities: ['course:manageactivities'] }],
  }),
}));
vi.mock('#lib/course-content', () => ({
  courseContentQueryOptions: (courseId: string) => ({ queryKey: ['course', courseId], queryFn: async () => ({ sections: [{ id: 'section-b', name: 'Bài học' }] }) }),
}));
vi.mock('../api/system-materials', () => ({
  materialSources: vi.fn(async () => []), materialSubmissions: vi.fn(async () => []), publishedMaterials: vi.fn(async () => []),
  submitMaterial: vi.fn(async () => ({})), reviewMaterial: vi.fn(async () => ({})), attachPublishedMaterial: vi.fn(async () => ({ cmId: 'cm-b', resourceId: 'r-b' })),
}));
const pkg: SystemMaterialPackage = {
  name: 'Học liệu A', resourceType: 'reference', description: 'Bài học đã duyệt', language: 'vi',
  subjectId: null, grade: null, level: null, curriculumNodeId: null, outcomeIds: [],
  externalUrl: null, file: { contentHash: 'a'.repeat(64), fileName: 'bai-hoc.pdf', mimeType: 'application/pdf', fileSize: 12 },
  source: { centreSlug: 'centre-a', contentId: '01961300-0000-7000-8000-000000000123', originalAuthor: 'Tác giả A', sourceKind: 'self', sourceCitation: null, license: 'CC BY 4.0' },
};

function showPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><SystemMaterialsPanel /></QueryClientProvider></MemoryRouter>);
}
beforeEach(() => { vi.clearAllMocks(); state.role = 'teacher'; });
afterEach(cleanup);

describe('Công bố học liệu và ghim phiên bản qua giao diện', () => {
  it('quản trị chọn học liệu của giáo viên để gửi, không phải chép UUID', async () => {
    state.role = 'manager';
    vi.mocked(materialSources).mockResolvedValue([{ id: pkg.source.contentId, name: pkg.name } as Awaited<ReturnType<typeof materialSources>>[number]]);
    showPanel();
    await screen.findByRole('option', { name: pkg.name });
    fireEvent.change(screen.getByRole('combobox', { name: 'Chọn học liệu trung tâm' }), { target: { value: pkg.source.contentId } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi lên hệ thống' }));
    await waitFor(() => expect(submitMaterial).toHaveBeenCalledWith(pkg.source.contentId));
  });

  it('biên tập viên thấy nguồn/giấy phép và preview, từ chối phải có lý do', async () => {
    state.role = 'editor';
    const row: SystemMaterialSubmission = { id: 'submission-1', centreSlug: 'centre-a', sourceContentId: pkg.source.contentId,
      sourceRevision: 'a'.repeat(64), checksum: 'a'.repeat(64), package: pkg, status: 'pending', rejectionReason: null, publishedMaterialId: null, publishedVersion: null };
    vi.mocked(materialSubmissions).mockResolvedValue([row]);
    showPanel();
    await screen.findByRole('option', { name: /Học liệu A/ });
    fireEvent.change(screen.getByRole('combobox', { name: 'Học liệu chờ hệ thống duyệt' }), { target: { value: row.id } });
    expect(screen.getByText('Giấy phép: CC BY 4.0')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xem tệp hoặc liên kết' })).toHaveAttribute('href', `/api/v1/system-bank/materials/submissions/${row.id}/media`);
    expect(screen.getByRole('button', { name: 'Từ chối' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Cần sửa nguồn' } });
    fireEvent.click(screen.getByRole('button', { name: 'Từ chối' }));
    await waitFor(() => expect(reviewMaterial).toHaveBeenCalledWith(row.id, 'Cần sửa nguồn'));

  });

  it('biên tập viên duyệt bản chụp được chọn sau khi xem nguồn và giấy phép', async () => {
    state.role = 'editor';
    showPanel();
    await screen.findByRole('option', { name: /Học liệu A/ });
    fireEvent.change(screen.getByRole('combobox', { name: 'Học liệu chờ hệ thống duyệt' }), { target: { value: 'submission-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(reviewMaterial).toHaveBeenCalledWith('submission-1'));
  });

  it('giáo viên chọn phiên bản cũ giữa nhiều bản, khoá và section rồi dùng nguyên trạng', async () => {
    const versions: SystemMaterialVersion[] = [1, 2].map((version) => ({ materialId: 'material-a', version, checksum: 'a'.repeat(64), package: pkg }));
    vi.mocked(publishedMaterials).mockResolvedValue(versions);
    showPanel();
    await screen.findByRole('option', { name: /Phiên bản 1/ });
    fireEvent.change(screen.getByRole('combobox', { name: 'Chọn phiên bản học liệu công bố' }), { target: { value: 'material-a:1' } });
    expect(screen.getByText('Tác giả gốc: Tác giả A')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Khoá học' }), { target: { value: 'course-b' } });
    await screen.findByRole('option', { name: 'Bài học' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Mục (section)' }), { target: { value: 'section-b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dùng phiên bản trong khoá' }));
    await waitFor(() => expect(attachPublishedMaterial).toHaveBeenCalledWith({ materialId: 'material-a', version: 1, courseId: 'course-b', sectionId: 'section-b' }));
    expect(await screen.findByRole('link', { name: 'Mở học liệu trong khoá' })).toHaveAttribute('href', '/courses/course-b/learn/cm-b');
  });

  it('học viên không tải bản gửi hoặc gói ngân hàng qua panel', () => {
    state.role = 'student';
    showPanel();
    expect(screen.queryByText('Học liệu hệ thống')).not.toBeInTheDocument();
    expect(publishedMaterials).not.toHaveBeenCalled();
    expect(materialSubmissions).not.toHaveBeenCalled();
    expect(materialSources).not.toHaveBeenCalled();
  });
});
