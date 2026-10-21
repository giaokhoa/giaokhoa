import { describe, expect, it, vi } from 'vitest';
import { FilesService } from '../src/files/service.js';

const OWNER_ID = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d22';
const STUDENT_ID = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d24';
const FILE_ID = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d21';
const VARIANT_ID = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d23';
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function createService() {
  const repository = {
    reserveUpload: vi.fn(async () => undefined),
    create: vi.fn(async (data: Record<string, unknown>, source?: unknown) => ({
      ...data,
      source,
      id: FILE_ID,
      createdAt: new Date(),
    })),
    createVariant: vi.fn(),
    find: vi.fn(),
    findOwned: vi.fn(),
    findVariant: vi.fn(),
    findVariantOwned: vi.fn(),
    findSourceOwned: vi.fn(),
    assignedFileClasses: vi.fn(
      async (_fileId: string, _variantFileId: string | null, _userId: string, _now: Date) =>
        [] as string[],
    ),
    hasReleasedSolutionFileAccess: vi.fn(async () => false),
    discardOrphans: vi.fn(async () => [] as string[]),
    queueExpiredOrphans: vi.fn(async () => ({ processed: 0, storageKeys: [] as string[] })),
    listPendingDeletions: vi.fn(async () => [] as string[]),
    acknowledgeDeletion: vi.fn(async () => undefined),
  };
  const storage = {
    put: vi.fn(async (_key: string, _body: Uint8Array, _mimeType: string) => undefined),
    get: vi.fn(async (_key: string) => ({ body: PNG_1X1 })),
    delete: vi.fn(async (_key: string) => undefined),
  };
  const authorization = {
    authorize: vi.fn(async () => ({ allowed: false })),
  };
  return {
    service: new FilesService(repository as never, storage as never, authorization as never),
    repository,
    storage,
    authorization,
  };
}

describe('FilesService security regressions', () => {
  it('strips active content and remote references before storing a TikZ SVG', async () => {
    const { service, repository, storage } = createService();
    const svg = Buffer.from(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" onload="alert(1)">',
        '<script>alert(2)</script>',
        '<foreignObject><iframe src="https://evil.example/"></iframe></foreignObject>',
        '<use href="javascript:alert(3)"/>',
        '<image href="https://evil.example/pixel.png"/>',
        '<rect width="120" height="80" onclick="alert(4)"/>',
        '</svg>',
      ].join(''),
    );
    const source = { kind: 'tikz', source: '\\begin{tikzpicture}\\end{tikzpicture}' };

    await service.createFile(
      { buffer: svg, originalname: 'diagram.svg', size: svg.length },
      OWNER_ID,
      source,
    );

    const stored = Buffer.from(storage.put.mock.calls[0]![1] as Uint8Array).toString('utf8');
    expect(stored).toContain('<rect');
    expect(stored).not.toMatch(
      /<script|foreignObject|iframe|onload|onclick|javascript:|evil\.example/i,
    );
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'image/svg+xml' }),
      source,
    );
  });

  it.each([
    [
      'inline URL',
      '<rect width="10" height="10" style="fill:url(https://attacker.example/a.svg#x)"/>',
    ],
    [
      'CSS import',
      '<style>@import url(https://attacker.example/a.css);</style><rect width="10" height="10"/>',
    ],
    [
      'CSS escape',
      '<rect width="10" height="10" style="fill:u\\\\72l(https://attacker.example/a.svg)"/>',
    ],
  ])('rejects remote CSS in TikZ SVG (%s)', async (_label, content) => {
    const { service, storage } = createService();
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${content}</svg>`,
    );
    await expect(
      service.createFile({ buffer: svg, size: svg.length, originalname: 'tikz.svg' }, OWNER_ID, {
        kind: 'tikz',
        source: 'diagram',
      }),
    ).rejects.toMatchObject({ kind: 'invalid' });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('preserves local CSS fragment references in TikZ SVG', async () => {
    const { service, storage } = createService();
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
        '<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs>' +
        '<rect width="10" height="10" style="fill:url(#g)"/></svg>',
    );
    await service.createFile(
      { buffer: svg, size: svg.length, originalname: 'tikz.svg' },
      OWNER_ID,
      { kind: 'tikz', source: 'diagram' },
    );
    expect(Buffer.from(storage.put.mock.calls[0]![1] as Uint8Array).toString()).toContain(
      'url(#g)',
    );
  });

  it('rejects a disguised SVG without TikZ source before writing any object', async () => {
    const { service, repository, storage } = createService();
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16"/></svg>',
    );

    await expect(
      service.createFile(
        { buffer: svg, originalname: 'not-really.png', size: svg.length },
        OWNER_ID,
      ),
    ).rejects.toMatchObject({ kind: 'invalid' });
    expect(storage.put).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects an oversized SVG canvas before storing any bytes', async () => {
    const { service, repository, storage } = createService();
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="12000" height="12000"><rect width="12000" height="12000"/></svg>',
    );

    await expect(
      service.createFile({ buffer: svg, originalname: 'giant.svg', size: svg.length }, OWNER_ID, {
        kind: 'tikz',
        source: 'valid tikz source',
      }),
    ).rejects.toMatchObject({ kind: 'invalid' });
    expect(storage.put).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('does not expose TikZ source to a student allowed to view the rendered file', async () => {
    const { service, repository, storage, authorization } = createService();
    repository.find.mockResolvedValue({
      id: FILE_ID,
      parentFileId: null,
      storageKey: 'files/test.svg',
      mimeType: 'image/svg+xml',
      byteSize: 20,
    });
    repository.assignedFileClasses.mockResolvedValue(['class-a']);
    authorization.authorize.mockResolvedValue({ allowed: true });

    await expect(service.getFile(FILE_ID, STUDENT_ID)).resolves.toMatchObject({
      mimeType: 'image/svg+xml',
    });
    await expect(service.getSource(FILE_ID, STUDENT_ID)).rejects.toMatchObject({
      kind: 'not_found',
    });
    expect(repository.findSourceOwned).toHaveBeenCalledWith(FILE_ID, STUDENT_ID);
    const source = { kind: 'tikz', source: 'owner only' };
    repository.findSourceOwned.mockResolvedValueOnce(source);
    await expect(service.getSource(FILE_ID, OWNER_ID)).resolves.toEqual(source);
    expect(storage.get).toHaveBeenCalledTimes(1);
  });

  it('checks assignment capability before reading a non-owner blob', async () => {
    const { service, repository, storage, authorization } = createService();
    repository.find.mockResolvedValue({
      id: FILE_ID,
      parentFileId: null,
      storageKey: 'files/private.png',
      mimeType: 'image/png',
      byteSize: PNG_1X1.length,
    });

    await expect(service.getFile(FILE_ID, STUDENT_ID)).rejects.toMatchObject({
      kind: 'not_found',
    });
    expect(authorization.authorize).not.toHaveBeenCalled();
    expect(storage.get).not.toHaveBeenCalled();

    repository.assignedFileClasses.mockResolvedValue(['class-a']);
    await expect(service.getFile(FILE_ID, STUDENT_ID)).rejects.toMatchObject({
      kind: 'not_found',
    });
    expect(authorization.authorize).toHaveBeenCalledWith({
      actorId: STUDENT_ID,
      capability: 'assignment:view_assigned',
      context: { kind: 'class', resourceKey: 'class-a' },
    });
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('never reveals the original when a student is assigned only its cropped variant', async () => {
    const { service, repository, storage, authorization } = createService();
    repository.find.mockResolvedValue({
      id: FILE_ID,
      parentFileId: null,
      storageKey: 'files/secret-original.png',
      mimeType: 'image/png',
      byteSize: PNG_1X1.length,
    });
    repository.findVariant.mockResolvedValue({
      id: VARIANT_ID,
      parentFileId: FILE_ID,
      storageKey: 'files/cropped-variant.png',
      mimeType: 'image/png',
      byteSize: PNG_1X1.length,
    });
    repository.assignedFileClasses.mockImplementation(async (_id, variantId) =>
      variantId === VARIANT_ID ? ['class-a'] : [],
    );
    authorization.authorize.mockResolvedValue({ allowed: true });

    await expect(service.getVariant(FILE_ID, VARIANT_ID, STUDENT_ID)).resolves.toMatchObject({
      mimeType: 'image/png',
    });
    await expect(service.getFile(FILE_ID, STUDENT_ID)).rejects.toMatchObject({
      kind: 'not_found',
      code: 'file_not_found',
    });
    expect(repository.assignedFileClasses).toHaveBeenCalledWith(
      FILE_ID,
      VARIANT_ID,
      STUDENT_ID,
      expect.any(Date),
    );
    expect(repository.assignedFileClasses).toHaveBeenCalledWith(
      FILE_ID,
      null,
      STUDENT_ID,
      expect.any(Date),
    );
    expect(storage.get).toHaveBeenCalledTimes(1);
    expect(storage.get).toHaveBeenCalledWith('files/cropped-variant.png');
  });

  it('allows a released solution image without granting class access to other files', async () => {
    const { service, repository, storage } = createService();
    repository.find.mockResolvedValue({
      id: FILE_ID,
      parentFileId: null,
      storageKey: 'files/answer.png',
      mimeType: 'image/png',
      byteSize: PNG_1X1.length,
    });
    repository.hasReleasedSolutionFileAccess.mockResolvedValueOnce(true);
    await expect(service.getFile(FILE_ID, STUDENT_ID)).resolves.toMatchObject({
      mimeType: 'image/png',
    });
    expect(repository.hasReleasedSolutionFileAccess).toHaveBeenCalledWith(
      FILE_ID,
      null,
      STUDENT_ID,
      expect.any(Date),
    );
    expect(storage.get).toHaveBeenCalledOnce();
    await expect(service.getFile(FILE_ID, STUDENT_ID)).rejects.toMatchObject({
      code: 'file_not_found',
    });
    expect(storage.get).toHaveBeenCalledOnce();
  });

  it.each(['original', 'variant'])(
    'keeps an upload intent when metadata and S3 cleanup fail (%s)',
    async (kind) => {
      const { service, repository, storage } = createService();
      repository.findOwned.mockResolvedValue({
        id: FILE_ID,
        parentFileId: null,
        mimeType: 'image/png',
      });
      repository.create.mockRejectedValueOnce(new Error('DB failed'));
      repository.createVariant.mockRejectedValueOnce(new Error('DB failed'));
      storage.delete.mockRejectedValueOnce(new Error('S3 unavailable'));
      const upload = { buffer: PNG_1X1, size: PNG_1X1.length, originalname: 'photo.png' };
      await expect(
        kind === 'original'
          ? service.createFile(upload, OWNER_ID)
          : service.createVariant(FILE_ID, upload, OWNER_ID),
      ).rejects.toThrow('DB failed');
      expect(repository.reserveUpload).toHaveBeenCalledOnce();
      expect(repository.reserveUpload.mock.invocationCallOrder[0]).toBeLessThan(
        storage.put.mock.invocationCallOrder[0]!,
      );
      expect(repository.acknowledgeDeletion).not.toHaveBeenCalled();
    },
  );

  it('does not delete a file when the repository finds it attached concurrently', async () => {
    const { service, repository, storage } = createService();
    repository.discardOrphans.mockResolvedValue([]);

    await service.discardFiles([{ fileId: FILE_ID, variantFileId: null }], OWNER_ID);

    expect(repository.discardOrphans).toHaveBeenCalledWith(
      [{ fileId: FILE_ID, variantFileId: null }],
      OWNER_ID,
    );
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('keeps failed object deletions queued for the next GC run', async () => {
    const { service, repository, storage } = createService();
    const storageKey = 'files/sha256/blob';
    const cutoff = new Date('2026-01-01T00:00:00Z');
    repository.listPendingDeletions
      .mockResolvedValueOnce([storageKey])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([storageKey])
      .mockResolvedValueOnce([]);
    storage.delete.mockRejectedValueOnce(new Error('S3 temporarily unavailable'));

    await expect(service.collectOrphanFiles(cutoff)).rejects.toThrow();
    expect(repository.acknowledgeDeletion).not.toHaveBeenCalled();

    await expect(service.collectOrphanFiles(cutoff)).resolves.toBe(1);
    expect(storage.delete).toHaveBeenCalledTimes(2);
    expect(repository.acknowledgeDeletion).toHaveBeenCalledExactlyOnceWith(storageKey);
  });
});
