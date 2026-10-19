export type StoredImageObject = {
  body?: Uint8Array;
  etag?: string;
};

export interface ImageStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredImageObject>;
  delete(key: string): Promise<void>;
}
