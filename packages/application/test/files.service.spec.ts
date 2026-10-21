import { describe, expect, it, vi } from 'vitest';
import { ClientError } from '../src/common/client-error.js';
import { FilesService } from '../src/files/service.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const USER_ID = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d22';
const FILE_ID = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d21';
const VARIANT_FILE_ID = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d23';

function createService() {
  const repository = {
    reserveUpload: vi.fn(async () => undefined),
    create: vi.fn(async (data: Record<string, unknown>) => ({
      ...data,
      id: FILE_ID,
      createdAt: new Date(),
    })),
    createVariant: vi.fn(async (data: Record<string, unknown>) => ({
      ...data,
      id: VARIANT_FILE_ID,
      createdAt: new Date(),
    })),
    find: vi.fn(),
    findOwned: vi.fn(),
    findVariant: vi.fn(),
    assignedFileClasses: vi.fn(async () => [] as string[]),
    releasedSolutionFileClasses: vi.fn(
      async () => [] as Array<{ classId: string; enrolmentStatus: 'active' | 'left' }>,
    ),
    findSourceOwned: vi.fn(),
    findVariantOwned: vi.fn(),
    discardOrphans: vi.fn(
      async (
        _refs: Array<{ fileId: string; variantFileId: string | null }>,
        _userId: string,
      ): Promise<string[]> => [],
    ),
    queueExpiredOrphans: vi.fn(async () => ({ processed: 0, storageKeys: [] as string[] })),
    listPendingDeletions: vi.fn(async () => [] as string[]),
    acknowledgeDeletion: vi.fn(async () => undefined),
  };
  const storage = {
    put: vi.fn(async (_key: string, _body: Buffer, _mimeType: string) => undefined),
    get: vi.fn(),
    delete: vi.fn(async (_key: string) => undefined),
  };

  const authorization = { authorize: vi.fn(async () => ({ allowed: false })) };
  return {
    service: new FilesService(repository as never, storage as never, authorization as never),
    repository,
    storage,
    authorization,
  };
}

describe('Dịch vụ tệp (FilesService)', () => {
  it('nhận diện dữ liệu ảnh và lưu ảnh gốc không thể thay đổi', async () => {
    const { service, repository, storage } = createService();

    const result = await service.createFile(
      { buffer: PNG_1X1, originalname: 'pixel.fake', size: PNG_1X1.length },
      USER_ID,
    );

    expect(storage.put).toHaveBeenCalledWith(
      expect.stringMatching(/^files\/objects\/[0-9a-f-]+\.png$/),
      PNG_1X1,
      'image/png',
    );
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: 'image/png',
        width: 1,
        height: 1,
        originalFilename: 'pixel.fake',
      }),
      undefined,
    );
    expect(result).toEqual({
      fileId: FILE_ID,
      variantFileId: null,
      width: 1,
      height: 1,
      mimeType: 'image/png',
    });
  });

  it('làm sạch SVG của TikZ và lưu mã nguồn riêng với dữ liệu ảnh', async () => {
    const { service, repository, storage } = createService();
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">' +
        '<script>alert(1)</script>' +
        '<use href="https://example.com/external.svg#x"/>' +
        '<rect width="120" height="80"/>' +
        '</svg>',
    );
    const source = {
      kind: 'tikz' as const,
      source: String.raw`\begin{tikzpicture}\draw (0,0) -- (1,1);\end{tikzpicture}`,
    };

    const result = await service.createFile(
      { buffer: svg, originalname: 'diagram.svg', size: svg.length },
      USER_ID,
      source,
    );

    const stored = storage.put.mock.calls[0]?.[1] as Uint8Array;
    expect(Buffer.from(stored).toString('utf8')).toContain('<rect');
    expect(Buffer.from(stored).toString('utf8')).not.toContain('<script');
    expect(Buffer.from(stored).toString('utf8')).not.toContain('https://example.com');
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: 'image/svg+xml',
        width: 120,
        height: 80,
        originalFilename: 'diagram.svg',
      }),
      source,
    );
    expect(result).toEqual({
      fileId: FILE_ID,
      variantFileId: null,
      width: 120,
      height: 80,
      mimeType: 'image/svg+xml',
    });
  });

  it('yêu cầu thông tin nguồn TikZ riêng tư khi tải SVG lên', async () => {
    const { service, repository, storage } = createService();
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
    );

    await expect(
      service.createFile({ buffer: svg, originalname: 'diagram.svg', size: svg.length }, USER_ID),
    ).rejects.toBeInstanceOf(ClientError);

    expect(storage.put).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('kiểm tra quyền đối với bài giao trước khi đọc dữ liệu nhị phân được chia sẻ', async () => {
    const { service, repository, storage, authorization } = createService();
    const record = {
      id: FILE_ID,
      parentFileId: null,
      storageKey: 'files/objects/test.png',
      mimeType: 'image/png',
      byteSize: PNG_1X1.length,
    };
    repository.findOwned.mockResolvedValue(undefined);
    repository.find.mockResolvedValue(record);
    repository.assignedFileClasses.mockResolvedValue([USER_ID]);
    storage.get.mockResolvedValue({ body: PNG_1X1 });
    authorization.authorize.mockResolvedValueOnce({ allowed: true });

    await expect(service.getFile(FILE_ID, USER_ID)).resolves.toMatchObject({
      mimeType: 'image/png',
    });
    expect(authorization.authorize).toHaveBeenCalledWith({
      actorId: USER_ID,
      capability: 'assignment:view_assigned',
      context: { kind: 'class', resourceKey: USER_ID },
    });
    expect(storage.get).toHaveBeenCalledTimes(1);

    authorization.authorize.mockResolvedValueOnce({ allowed: false });
    await expect(service.getFile(FILE_ID, USER_ID)).rejects.toMatchObject({
      code: 'file_not_found',
    });
    expect(storage.get).toHaveBeenCalledTimes(1);
  });

  it('chỉ trả mã nguồn TikZ khi tra cứu theo chủ sở hữu', async () => {
    const { service, repository } = createService();
    const source = {
      kind: 'tikz' as const,
      source: String.raw`\begin{tikzpicture}\end{tikzpicture}`,
    };
    repository.findSourceOwned.mockResolvedValueOnce(source);

    await expect(service.getSource(FILE_ID, USER_ID)).resolves.toEqual(source);
    expect(repository.findSourceOwned).toHaveBeenCalledWith(FILE_ID, USER_ID);
  });

  it('không tạo biến thể cắt ảnh đối với SVG', async () => {
    const { service, repository, storage } = createService();
    repository.findOwned.mockResolvedValueOnce({
      id: FILE_ID,
      createdByUserId: USER_ID,
      parentFileId: null,
      mimeType: 'image/svg+xml',
    });

    await expect(
      service.createVariant(
        FILE_ID,
        { buffer: PNG_1X1, originalname: 'crop.png', size: PNG_1X1.length },
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(ClientError);

    expect(storage.put).not.toHaveBeenCalled();
    expect(repository.createVariant).not.toHaveBeenCalled();
  });

  it('lưu biến thể cắt ảnh dưới ảnh gốc thuộc chủ sở hữu', async () => {
    const { service, repository, storage } = createService();
    repository.findOwned.mockResolvedValueOnce({
      id: FILE_ID,
      createdByUserId: USER_ID,
      parentFileId: null,
    });

    const result = await service.createVariant(
      FILE_ID,
      { buffer: PNG_1X1, originalname: 'crop.png', size: PNG_1X1.length },
      USER_ID,
    );

    expect(repository.findOwned).toHaveBeenCalledWith(FILE_ID, USER_ID);
    expect(storage.put).toHaveBeenCalledWith(
      expect.stringMatching(/^files\/objects\/[0-9a-f-]+\.png$/),
      PNG_1X1,
      'image/png',
    );
    expect(repository.createVariant).toHaveBeenCalledWith(
      expect.objectContaining({
        parentFileId: FILE_ID,
        mimeType: 'image/png',
        width: 1,
        height: 1,
        originalFilename: 'crop.png',
      }),
    );
    expect(result).toEqual({
      fileId: FILE_ID,
      variantFileId: VARIANT_FILE_ID,
      width: 1,
      height: 1,
      mimeType: 'image/png',
    });
  });

  it('không cho tạo biến thể dưới ảnh không thuộc người dùng', async () => {
    const { service, repository, storage } = createService();
    repository.findOwned.mockResolvedValueOnce(undefined);

    await expect(
      service.createVariant(
        FILE_ID,
        { buffer: PNG_1X1, originalname: 'crop.png', size: PNG_1X1.length },
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(ClientError);

    expect(storage.put).not.toHaveBeenCalled();
    expect(repository.createVariant).not.toHaveBeenCalled();
  });

  it('từ chối dữ liệu không được hỗ trợ trước khi truy cập kho đối tượng', async () => {
    const { service, repository, storage } = createService();

    await expect(
      service.createFile(
        { buffer: Buffer.from('not an image'), originalname: 'file.txt', size: 12 },
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(ClientError);

    expect(storage.put).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('xóa đối tượng đã tải lên nếu lưu thông tin ảnh gốc thất bại', async () => {
    const { service, repository, storage } = createService();
    repository.create.mockRejectedValueOnce(new Error('database failed'));

    await expect(
      service.createFile(
        { buffer: PNG_1X1, originalname: 'pixel.png', size: PNG_1X1.length },
        USER_ID,
      ),
    ).rejects.toThrow('database failed');

    expect(storage.delete).toHaveBeenCalledOnce();
  });

  it('xóa biến thể đã tải lên nếu lưu thông tin biến thể thất bại', async () => {
    const { service, repository, storage } = createService();
    repository.findOwned.mockResolvedValueOnce({
      id: FILE_ID,
      createdByUserId: USER_ID,
      parentFileId: null,
    });
    repository.createVariant.mockRejectedValueOnce(new Error('database failed'));

    await expect(
      service.createVariant(
        FILE_ID,
        { buffer: PNG_1X1, originalname: 'crop.png', size: PNG_1X1.length },
        USER_ID,
      ),
    ).rejects.toThrow('database failed');

    expect(storage.delete).toHaveBeenCalledOnce();
  });
});

describe('Vòng đời loại bỏ tệp của dịch vụ tệp (FilesService)', () => {
  it('mỗi tham chiếu ảnh đang chờ chỉ được loại bỏ tối đa một lần', async () => {
    const { service, repository } = createService();
    const discarded: Array<{ fileId: string; variantFileId: string | null }> = [];
    repository.discardOrphans.mockImplementationOnce(async (refs) => {
      discarded.push(...refs);
      return [];
    });

    await service.discardFiles(
      [
        { fileId: FILE_ID, variantFileId: null },
        { fileId: FILE_ID, variantFileId: null },
        { fileId: FILE_ID, variantFileId: VARIANT_FILE_ID },
      ],
      USER_ID,
    );

    expect(discarded).toEqual([
      { fileId: FILE_ID, variantFileId: null },
      { fileId: FILE_ID, variantFileId: VARIANT_FILE_ID },
    ]);
  });

  it('từ chối dữ liệu yêu cầu loại bỏ tệp sai cấu trúc', async () => {
    const { service, repository } = createService();

    await expect(
      service.discardFiles([{ fileId: 'bad', variantFileId: null }] as never, USER_ID),
    ).rejects.toBeInstanceOf(ClientError);

    expect(repository.discardOrphans).not.toHaveBeenCalled();
  });
});

describe('Thu gom tệp không còn sử dụng của dịch vụ tệp (FilesService)', () => {
  it('tiếp tục xử lý theo đợt khi xóa tệp logic nhưng vẫn giữ dữ liệu dùng chung', async () => {
    const { service, repository, storage } = createService();
    const cutoff = new Date('2026-01-01T00:00:00Z');
    repository.queueExpiredOrphans
      .mockResolvedValueOnce({ processed: 100, storageKeys: [] })
      .mockResolvedValueOnce({ processed: 1, storageKeys: [] })
      .mockResolvedValueOnce({ processed: 0, storageKeys: [] });

    await expect(service.collectOrphanFiles(cutoff)).resolves.toBe(0);
    expect(repository.queueExpiredOrphans).toHaveBeenCalledTimes(3);
    expect(repository.listPendingDeletions).toHaveBeenCalledTimes(1);
    expect(storage.delete).not.toHaveBeenCalled();
  });
});

describe('Quyền truy cập dữ liệu nhị phân qua dịch vụ tệp (FilesService)', () => {
  it('chỉ trả dữ liệu ảnh gốc sau khi kho dữ liệu xác nhận quyền sở hữu', async () => {
    const { service, repository, storage } = createService();
    repository.findOwned.mockResolvedValueOnce(undefined);
    await expect(service.getFile(FILE_ID, USER_ID)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'file_not_found',
    });
    expect(storage.get).not.toHaveBeenCalled();

    repository.findOwned.mockResolvedValueOnce({
      id: FILE_ID,
      parentFileId: null,
      storageKey: 'files/objects/private.png',
      mimeType: 'image/png',
      byteSize: PNG_1X1.length,
    });
    storage.get.mockResolvedValueOnce({ body: PNG_1X1, etag: 'etag' });
    await expect(service.getFile(FILE_ID, USER_ID)).resolves.toMatchObject({
      body: PNG_1X1,
      mimeType: 'image/png',
    });
    expect(repository.findOwned).toHaveBeenCalledWith(FILE_ID, USER_ID);
  });

  it('yêu cầu quyền sở hữu ảnh gốc trước khi cung cấp biến thể', async () => {
    const { service, repository, storage } = createService();
    repository.findVariantOwned.mockResolvedValueOnce(undefined);
    await expect(service.getVariant(FILE_ID, VARIANT_FILE_ID, USER_ID)).rejects.toMatchObject({
      kind: 'not_found',
    });
    expect(storage.get).not.toHaveBeenCalled();

    repository.findVariantOwned.mockResolvedValueOnce({
      fileId: FILE_ID,
      id: VARIANT_FILE_ID,
      storageKey: 'files/objects/private.png',
      mimeType: 'image/png',
      byteSize: PNG_1X1.length,
    });
    storage.get.mockResolvedValueOnce({ body: PNG_1X1 });
    await expect(service.getVariant(FILE_ID, VARIANT_FILE_ID, USER_ID)).resolves.toMatchObject({
      body: PNG_1X1,
    });
    expect(repository.findVariantOwned).toHaveBeenCalledWith(FILE_ID, VARIANT_FILE_ID, USER_ID);
  });
});
