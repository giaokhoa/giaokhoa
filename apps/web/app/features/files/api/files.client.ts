import { filesContract } from '@giaokhoa/shared/http/files';
import type { LoadOriginalImage, LoadTikzSource, UploadImage } from '@giaokhoa/editor';
import { browserHttp } from '#lib/http/browser.js';
import { getRequestErrorMessage } from '#lib/http/errors.js';

export const loadOriginalImage: LoadOriginalImage = async (fileId) => {
  const src = filesContract.get.path.replace(':id', encodeURIComponent(fileId));
  try {
    const response = await browserHttp.request<Blob>({
      url: src,
      method: filesContract.get.method,
      responseType: 'blob',
    });
    return { blob: response.data, src };
  } catch (error) {
    throw new Error(getRequestErrorMessage(error, 'Không thể tải ảnh gốc.'));
  }
};

export const loadTikzSource: LoadTikzSource = async (fileId) => {
  try {
    const response = await browserHttp.request<unknown>({
      url: filesContract.getSource.path.replace(':id', encodeURIComponent(fileId)),
      method: filesContract.getSource.method,
    });
    const parsed = filesContract.getSource.responses[200].safeParse(response.data);
    if (!parsed.success) throw new Error('Nguồn TikZ không hợp lệ.');
    return parsed.data.source;
  } catch (error) {
    throw new Error(getRequestErrorMessage(error, 'Không thể tải nguồn TikZ để chỉnh sửa.'));
  }
};

export const uploadImage: UploadImage = async (file, fileId, source) => {
  if (fileId && source) throw new Error('TikZ không tạo crop variant.');

  const contract = fileId ? filesContract.uploadVariant : filesContract.upload;
  const formData = new FormData();
  formData.set(contract.file.field, file);
  if (source) {
    formData.set('kind', source.kind);
    formData.set('source', source.source);
  }

  const endpoint = fileId
    ? filesContract.uploadVariant.path.replace(':id', encodeURIComponent(fileId))
    : filesContract.upload.path;

  try {
    const response = await browserHttp.request<unknown>({
      url: endpoint,
      method: contract.method,
      data: formData,
    });
    const parsed = contract.responses[201].safeParse(response.data);
    if (!parsed.success) throw new Error('Phản hồi upload ảnh không hợp lệ');
    return parsed.data;
  } catch (error) {
    throw new Error(getRequestErrorMessage(error, 'Không thể tải ảnh'));
  }
};

export async function discardFiles(files: Array<{ fileId: string; variantFileId: string | null }>) {
  const body = filesContract.discard.body.parse({ files });
  await browserHttp.request({
    url: filesContract.discard.path,
    method: filesContract.discard.method,
    data: body,
  });
}
