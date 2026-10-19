import { imagesContract } from '@giaokhoa/shared/http/images';
import type { LoadOriginalImage, LoadTikzSource, UploadImage } from '@giaokhoa/editor';
import { browserHttp } from '#lib/http/browser.js';
import { getRequestErrorMessage } from '#lib/http/errors.js';

export const loadOriginalImage: LoadOriginalImage = async (imageId) => {
  const src = imagesContract.get.path.replace(':id', encodeURIComponent(imageId));
  try {
    const response = await browserHttp.request<Blob>({
      url: src,
      method: imagesContract.get.method,
      responseType: 'blob',
    });
    return { blob: response.data, src };
  } catch (error) {
    throw new Error(getRequestErrorMessage(error, 'Không thể tải ảnh gốc.'));
  }
};

export const loadTikzSource: LoadTikzSource = async (imageId) => {
  try {
    const response = await browserHttp.request<unknown>({
      url: imagesContract.getSource.path.replace(':id', encodeURIComponent(imageId)),
      method: imagesContract.getSource.method,
    });
    const parsed = imagesContract.getSource.responses[200].safeParse(response.data);
    if (!parsed.success) throw new Error('Nguồn TikZ không hợp lệ.');
    return parsed.data.source;
  } catch (error) {
    throw new Error(getRequestErrorMessage(error, 'Không thể tải nguồn TikZ để chỉnh sửa.'));
  }
};

export const uploadImage: UploadImage = async (file, imageId, source) => {
  if (imageId && source) throw new Error('TikZ không tạo crop variant.');

  const contract = imageId ? imagesContract.uploadVariant : imagesContract.upload;
  const formData = new FormData();
  formData.set(contract.file.field, file);
  if (source) {
    formData.set('kind', source.kind);
    formData.set('source', source.source);
  }

  const endpoint = imageId
    ? imagesContract.uploadVariant.path.replace(':id', encodeURIComponent(imageId))
    : imagesContract.upload.path;

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

export async function discardImages(
  images: Array<{ imageId: string; imageVariantId: string | null }>,
) {
  const body = imagesContract.discard.body.parse({ images });
  await browserHttp.request({
    url: imagesContract.discard.path,
    method: imagesContract.discard.method,
    data: body,
  });
}
