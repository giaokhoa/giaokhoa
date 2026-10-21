export type StoredFileObject = {
  body?: Uint8Array;
  etag?: string;
};

/** Cổng lưu đối tượng nhị phân; không tự quyết định quyền xem hoặc thời điểm xóa tệp logic. */
export interface FileStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredFileObject>;
  delete(key: string): Promise<void>;
}
