import { describe, expect, it, vi } from 'vitest';
import { ClientError } from '../src/common/client-error.js';
import { ImagesService } from '../src/images/service.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const USER_ID = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d22';
const IMAGE_ID = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d21';
const IMAGE_VARIANT_ID = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d23';

function createService() {
  const repository = {
    create: vi.fn(async (data: Record<string, unknown>) => ({
      ...data,
      id: IMAGE_ID,
      createdAt: new Date(),
    })),
    createVariant: vi.fn(async (data: Record<string, unknown>) => ({
      ...data,
      id: IMAGE_VARIANT_ID,
      createdAt: new Date(),
    })),
    find: vi.fn(),
    findOwned: vi.fn(),
    findSourceOwned: vi.fn(),
    findVariant: vi.fn(),
    discardOrphans: vi.fn(
      async (
        _refs: Array<{ imageId: string; imageVariantId: string | null }>,
        _userId: string,
      ): Promise<string[]> => [],
    ),
  };
  const storage = {
    put: vi.fn(async (_key: string, _body: Buffer, _mimeType: string) => undefined),
    get: vi.fn(),
    delete: vi.fn(async (_key: string) => undefined),
  };

  return {
    service: new ImagesService(repository as never, storage as never),
    repository,
    storage,
  };
}

describe('ImagesService', () => {
  it('detects image bytes and persists an immutable original image', async () => {
    const { service, repository, storage } = createService();

    const result = await service.createImage(
      { buffer: PNG_1X1, originalname: 'pixel.fake', size: PNG_1X1.length },
      USER_ID,
    );

    expect(storage.put).toHaveBeenCalledWith(
      expect.stringMatching(/^images\/originals\/[0-9a-f-]+\.png$/),
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
      imageId: IMAGE_ID,
      imageVariantId: null,
      width: 1,
      height: 1,
      mimeType: 'image/png',
    });
  });

  it('sanitizes a TikZ SVG and stores its source separately from the image bytes', async () => {
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

    const result = await service.createImage(
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
      imageId: IMAGE_ID,
      imageVariantId: null,
      width: 120,
      height: 80,
      mimeType: 'image/svg+xml',
    });
  });

  it('requires private TikZ source metadata for SVG uploads', async () => {
    const { service, repository, storage } = createService();
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
    );

    await expect(
      service.createImage({ buffer: svg, originalname: 'diagram.svg', size: svg.length }, USER_ID),
    ).rejects.toBeInstanceOf(ClientError);

    expect(storage.put).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('returns TikZ source only through the owner lookup', async () => {
    const { service, repository } = createService();
    const source = {
      kind: 'tikz' as const,
      source: String.raw`\begin{tikzpicture}\end{tikzpicture}`,
    };
    repository.findSourceOwned.mockResolvedValueOnce(source);

    await expect(service.getImageSource(IMAGE_ID, USER_ID)).resolves.toEqual(source);
    expect(repository.findSourceOwned).toHaveBeenCalledWith(IMAGE_ID, USER_ID);
  });

  it('does not create crop variants for SVG images', async () => {
    const { service, repository, storage } = createService();
    repository.findOwned.mockResolvedValueOnce({
      id: IMAGE_ID,
      createdByUserId: USER_ID,
      mimeType: 'image/svg+xml',
    });

    await expect(
      service.createImageVariant(
        IMAGE_ID,
        { buffer: PNG_1X1, originalname: 'crop.png', size: PNG_1X1.length },
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(ClientError);

    expect(storage.put).not.toHaveBeenCalled();
    expect(repository.createVariant).not.toHaveBeenCalled();
  });

  it('persists a crop variant below an owned original image', async () => {
    const { service, repository, storage } = createService();
    repository.findOwned.mockResolvedValueOnce({ id: IMAGE_ID, createdByUserId: USER_ID });

    const result = await service.createImageVariant(
      IMAGE_ID,
      { buffer: PNG_1X1, originalname: 'crop.png', size: PNG_1X1.length },
      USER_ID,
    );

    expect(repository.findOwned).toHaveBeenCalledWith(IMAGE_ID, USER_ID);
    expect(storage.put).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^images/derived/${IMAGE_ID}/[0-9a-f-]+\\.png$`)),
      PNG_1X1,
      'image/png',
    );
    expect(repository.createVariant).toHaveBeenCalledWith(
      expect.objectContaining({
        imageId: IMAGE_ID,
        mimeType: 'image/png',
        width: 1,
        height: 1,
        filename: 'crop.png',
      }),
    );
    expect(result).toEqual({
      imageId: IMAGE_ID,
      imageVariantId: IMAGE_VARIANT_ID,
      width: 1,
      height: 1,
      mimeType: 'image/png',
    });
  });

  it('does not allow creating a variant below an image the user does not own', async () => {
    const { service, repository, storage } = createService();
    repository.findOwned.mockResolvedValueOnce(undefined);

    await expect(
      service.createImageVariant(
        IMAGE_ID,
        { buffer: PNG_1X1, originalname: 'crop.png', size: PNG_1X1.length },
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(ClientError);

    expect(storage.put).not.toHaveBeenCalled();
    expect(repository.createVariant).not.toHaveBeenCalled();
  });

  it('rejects unsupported bytes before touching object storage', async () => {
    const { service, repository, storage } = createService();

    await expect(
      service.createImage(
        { buffer: Buffer.from('not an image'), originalname: 'file.txt', size: 12 },
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(ClientError);

    expect(storage.put).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('deletes the uploaded object if original metadata persistence fails', async () => {
    const { service, repository, storage } = createService();
    repository.create.mockRejectedValueOnce(new Error('database failed'));

    await expect(
      service.createImage(
        { buffer: PNG_1X1, originalname: 'pixel.png', size: PNG_1X1.length },
        USER_ID,
      ),
    ).rejects.toThrow('database failed');

    expect(storage.delete).toHaveBeenCalledOnce();
  });

  it('deletes the uploaded variant if variant metadata persistence fails', async () => {
    const { service, repository, storage } = createService();
    repository.findOwned.mockResolvedValueOnce({ id: IMAGE_ID, createdByUserId: USER_ID });
    repository.createVariant.mockRejectedValueOnce(new Error('database failed'));

    await expect(
      service.createImageVariant(
        IMAGE_ID,
        { buffer: PNG_1X1, originalname: 'crop.png', size: PNG_1X1.length },
        USER_ID,
      ),
    ).rejects.toThrow('database failed');

    expect(storage.delete).toHaveBeenCalledOnce();
  });
});

describe('ImagesService discard lifecycle', () => {
  it('discards each pending image reference at most once', async () => {
    const { service, repository } = createService();
    const discarded: Array<{ imageId: string; imageVariantId: string | null }> = [];
    repository.discardOrphans.mockImplementationOnce(async (refs) => {
      discarded.push(...refs);
      return [];
    });

    await service.discardImages(
      [
        { imageId: IMAGE_ID, imageVariantId: null },
        { imageId: IMAGE_ID, imageVariantId: null },
        { imageId: IMAGE_ID, imageVariantId: IMAGE_VARIANT_ID },
      ],
      USER_ID,
    );

    expect(discarded).toEqual([
      { imageId: IMAGE_ID, imageVariantId: null },
      { imageId: IMAGE_ID, imageVariantId: IMAGE_VARIANT_ID },
    ]);
  });

  it('rejects malformed discard payloads', async () => {
    const { service, repository } = createService();

    await expect(
      service.discardImages([{ imageId: 'bad', imageVariantId: null }] as never, USER_ID),
    ).rejects.toBeInstanceOf(ClientError);

    expect(repository.discardOrphans).not.toHaveBeenCalled();
  });
});
