export type StoredFileObject = {
  body?: Uint8Array;
  etag?: string;
};

/** Cổng lưu trữ dữ liệu nhị phân; không tự quyết định quyền xem hoặc thời điểm xóa bản ghi tệp. */
export interface FileStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredFileObject>;
  delete(key: string): Promise<void>;
}
