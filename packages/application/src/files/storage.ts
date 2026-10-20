export type StoredFileObject = {
  body?: Uint8Array;
  etag?: string;
};

export interface FileStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredFileObject>;
  delete(key: string): Promise<void>;
}
