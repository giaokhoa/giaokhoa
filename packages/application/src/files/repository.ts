import type { FileRef, TikzFileSource } from '@giaokhoa/shared/files';

/** Tệp logic riêng theo chủ sở hữu; nhiều tệp có thể tham chiếu cùng đối tượng nhị phân theo mã băm. */
export type FileRecord = {
  id: string;
  createdByUserId: string;
  contentHash: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  originalFilename: string;
  parentFileId: string | null;
  orphanedAt: Date | null;
  createdAt: Date;
};

export type CreateFileData = Omit<FileRecord, 'id' | 'orphanedAt' | 'createdAt'>;
export type CreateFileVariantData = CreateFileData & { parentFileId: string };

/** Hợp đồng tệp logic và hàng đợi xóa; giao dịch dữ liệu bảo vệ tham chiếu, còn xóa đối tượng lưu trữ xử lý riêng. */
export interface FilesRepository {
  /** Lưu ý định tải lên trước khi ghi đối tượng để thu gom được tệp thất bại giữa chừng. */
  reserveUpload(storageKey: string): Promise<void>;
  create(data: CreateFileData, source?: TikzFileSource): Promise<FileRecord>;
  createVariant(data: CreateFileVariantData): Promise<FileRecord>;
  find(id: string): Promise<FileRecord | undefined>;
  findOwned(id: string, userId: string): Promise<FileRecord | undefined>;
  findVariant(fileId: string, variantFileId: string): Promise<FileRecord | undefined>;
  findVariantOwned(
    fileId: string,
    variantFileId: string,
    userId: string,
  ): Promise<FileRecord | undefined>;
  findSourceOwned(id: string, userId: string): Promise<TikzFileSource | undefined>;
  /** Chỉ trả lớp có bản chụp câu hỏi thực sự chứa ảnh trong phần được giao cho người nhận. */
  assignedFileClasses(
    fileId: string,
    variantFileId: string | null,
    userId: string,
    now: Date,
  ): Promise<string[]>;
  /** Đối chiếu ảnh lời giải với lượt đã nộp và mốc công bố; trả trạng thái tham gia để xét quyền hiện tại. */
  releasedSolutionFileClasses(
    fileId: string,
    variantFileId: string | null,
    userId: string,
    now: Date,
  ): Promise<Array<{ classId: string; enrolmentStatus: 'active' | 'left' }>>;
  discardOrphans(refs: FileRef[], userId: string): Promise<string[]>;
  /** Chỉ xóa tệp nháp hết hạn khi không còn tham chiếu; xếp khóa đối tượng khi không còn tệp nào dùng chung. */
  queueExpiredOrphans(cutoff: Date): Promise<{ processed: number; storageKeys: string[] }>;
  /** Chỉ liệt kê khóa đã hết thời gian chờ xóa, hỗ trợ phân trang qua khóa đã duyệt. */
  listPendingDeletions(afterStorageKey?: string): Promise<string[]>;
  acknowledgeDeletion(storageKey: string): Promise<void>;
}
