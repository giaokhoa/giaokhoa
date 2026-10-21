import type { FileRef, TikzFileSource } from '@giaokhoa/shared/files';

/** Mỗi bản ghi tệp có chủ sở hữu riêng; nhiều bản ghi có thể cùng dùng một đối tượng nhị phân theo mã băm. */
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

/** Hợp đồng quản lý bản ghi tệp và hàng đợi xóa; giao dịch bảo vệ tham chiếu, còn đối tượng lưu trữ được xóa riêng. */
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
  /** Chỉ trả bài giao có bản chụp câu hỏi thực sự chứa ảnh trong phần được giao cho người nhận. */
  assignedFileAssignments(
    fileId: string,
    variantFileId: string | null,
    userId: string,
    now: Date,
  ): Promise<string[]>;
  /** Đối chiếu ảnh lời giải với lượt đã nộp và mốc công bố; trả trạng thái tham gia để xét quyền hiện tại. */
  releasedSolutionFileAssignments(
    fileId: string,
    variantFileId: string | null,
    userId: string,
    now: Date,
  ): Promise<Array<{ assignmentId: string; enrolmentStatus: 'active' | 'left' }>>;
  discardOrphans(refs: FileRef[], userId: string): Promise<string[]>;
  /** Chỉ xóa tệp nháp hết hạn nếu không còn tham chiếu; chỉ xếp khóa để xóa khi không có tệp nào dùng chung. */
  queueExpiredOrphans(cutoff: Date): Promise<{ processed: number; storageKeys: string[] }>;
  /** Chỉ liệt kê khóa đã đến thời điểm được xóa; hỗ trợ phân trang theo khóa đã duyệt. */
  listPendingDeletions(afterStorageKey?: string): Promise<string[]>;
  acknowledgeDeletion(storageKey: string): Promise<void>;
}
