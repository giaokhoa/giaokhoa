import { Button } from '@giaokhoa/ui/components/button';
import { Input } from '@giaokhoa/ui/components/input';
import { ImagePlus } from 'lucide-react';
import { useState } from 'react';
import ReactCrop, { centerCrop, makeAspectCrop, type PercentCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

export type ImageCrop = PercentCrop;

export const FULL_IMAGE_CROP: ImageCrop = {
  unit: '%',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
};

type AspectPreset = 'free' | 'original' | '1:1' | '4:3' | '3:2' | '16:9';

type ImageEditorOverlayProps = {
  ownerId: string;
  file?: File;
  fileNameStem?: string;
  previewUrl?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  crop?: ImageCrop;
  editing?: boolean;
  loading?: boolean;
  uploading: boolean;
  error?: string;
  onFileChange: (file: File) => void;
  onFileNameChange: (name: string) => void;
  onImageLoad: (width: number, height: number) => void;
  onPreviewError: () => void;
  onCropChange: (crop: ImageCrop) => void;
  onClose: () => void;
  onSave: () => void;
};

function imageExtension(file: File) {
  if (file.type === 'image/jpeg') {
    return file.name.toLowerCase().endsWith('.jpeg') ? 'jpeg' : 'jpg';
  }
  if (file.type === 'image/webp') return 'webp';
  return 'png';
}

export function imageNameStem(file: File) {
  const extension = file.name.match(/\.[^.]+$/)?.[0];
  const stem = extension ? file.name.slice(0, -extension.length) : file.name;
  return stem || 'image';
}

function normalizedFileName(file: File, fileNameStem: string) {
  const stem = fileNameStem.trim().replace(/[\\/]/g, '-');
  return `${stem || 'image'}.${imageExtension(file)}`;
}

function cropPixels(naturalWidth: number, naturalHeight: number, crop: ImageCrop) {
  const x = Math.max(0, Math.round((crop.x / 100) * naturalWidth));
  const y = Math.max(0, Math.round((crop.y / 100) * naturalHeight));
  const width = Math.max(
    1,
    Math.min(naturalWidth - x, Math.round((crop.width / 100) * naturalWidth)),
  );
  const height = Math.max(
    1,
    Math.min(naturalHeight - y, Math.round((crop.height / 100) * naturalHeight)),
  );

  return { x, y, width, height };
}

export async function cropImageFile(
  file: File,
  fileNameStem: string,
  naturalWidth: number,
  naturalHeight: number,
  crop: ImageCrop,
) {
  const pixels = cropPixels(naturalWidth, naturalHeight, crop);
  const name = normalizedFileName(file, fileNameStem);
  const isFullImage =
    pixels.x === 0 &&
    pixels.y === 0 &&
    pixels.width === naturalWidth &&
    pixels.height === naturalHeight;

  if (isFullImage) {
    return {
      file: new File([file], name, { type: file.type, lastModified: file.lastModified }),
      width: naturalWidth,
      height: naturalHeight,
    };
  }

  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = pixels.width;
    canvas.height = pixels.height;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Trình duyệt không hỗ trợ crop ảnh.');

    context.drawImage(
      bitmap,
      pixels.x,
      pixels.y,
      pixels.width,
      pixels.height,
      0,
      0,
      pixels.width,
      pixels.height,
    );

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('Không thể tạo ảnh đã crop.'))),
        file.type,
        file.type === 'image/png' ? undefined : 0.92,
      );
    });

    return {
      file: new File([blob], name, { type: file.type, lastModified: Date.now() }),
      width: pixels.width,
      height: pixels.height,
    };
  } finally {
    bitmap.close();
  }
}

function aspectForPreset(preset: AspectPreset, naturalWidth?: number, naturalHeight?: number) {
  if (preset === '1:1') return 1;
  if (preset === '4:3') return 4 / 3;
  if (preset === '3:2') return 3 / 2;
  if (preset === '16:9') return 16 / 9;
  if (preset === 'original' && naturalWidth && naturalHeight) return naturalWidth / naturalHeight;
  return undefined;
}

function cropForAspect(aspect: number, width: number, height: number) {
  return centerCrop(makeAspectCrop({ unit: '%', width: 90 }, aspect, width, height), width, height);
}

export function ImageEditorOverlay({
  ownerId,
  file,
  fileNameStem = '',
  previewUrl,
  naturalWidth,
  naturalHeight,
  crop = FULL_IMAGE_CROP,
  editing = false,
  loading = false,
  uploading,
  error,
  onFileChange,
  onFileNameChange,
  onImageLoad,
  onPreviewError,
  onCropChange,
  onClose,
  onSave,
}: ImageEditorOverlayProps) {
  const [aspectPreset, setAspectPreset] = useState<AspectPreset>('free');
  const aspect = aspectForPreset(aspectPreset, naturalWidth, naturalHeight);
  const croppedNaturalWidth =
    naturalWidth && crop.width ? Math.max(1, Math.round((naturalWidth * crop.width) / 100)) : 0;
  const croppedNaturalHeight =
    naturalHeight && crop.height ? Math.max(1, Math.round((naturalHeight * crop.height) / 100)) : 0;
  const ready = Boolean(
    file &&
    previewUrl &&
    naturalWidth &&
    naturalHeight &&
    croppedNaturalWidth &&
    croppedNaturalHeight &&
    fileNameStem.trim(),
  );

  const chooseFirstFile = (files: FileList | null) => {
    const nextFile = files?.[0];
    if (nextFile) onFileChange(nextFile);
  };

  const changeAspect = (preset: AspectPreset) => {
    setAspectPreset(preset);
    if (!naturalWidth || !naturalHeight) return;

    if (preset === 'free') return;
    if (preset === 'original') {
      onCropChange({ ...FULL_IMAGE_CROP });
      return;
    }

    const nextAspect = aspectForPreset(preset, naturalWidth, naturalHeight);
    if (nextAspect) onCropChange(cropForAspect(nextAspect, naturalWidth, naturalHeight));
  };

  return (
    <div
      data-editor-owner={ownerId}
      className="fixed top-16 left-1/2 z-[60] max-h-[calc(100vh-5rem)] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 overflow-y-auto rounded-2xl border bg-background p-5 shadow-2xl"
    >
      <input
        id={`${ownerId}-image-file`}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        disabled={loading || uploading}
        onChange={(event) => {
          chooseFirstFile(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
      />

      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{editing ? 'Sửa ảnh' : 'Ảnh'}</div>
          <div className="text-xs text-muted-foreground">
            {editing
              ? 'Crop lại từ ảnh hiện tại, đổi tên hoặc chọn ảnh khác.'
              : 'Crop và đổi tên. Chỉ tải lên khi bấm Xong.'}
          </div>
        </div>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="sm" disabled={uploading} onClick={onClose}>
            Hủy
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!ready || uploading}
            onClick={onSave}
          >
            {uploading ? 'Đang tải…' : 'Xong'}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-56 items-center justify-center rounded-xl border bg-muted/20 p-6 text-sm text-muted-foreground">
          Đang tải ảnh…
        </div>
      ) : !previewUrl ? (
        <label
          htmlFor={`${ownerId}-image-file`}
          className="flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 p-6 text-center"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (!uploading) chooseFirstFile(event.dataTransfer.files);
          }}
        >
          <ImagePlus className="mb-3 size-8 text-muted-foreground" />
          <div className="text-sm font-medium">Chọn hoặc thả ảnh vào đây</div>
          <div className="mt-1 text-xs text-muted-foreground">PNG, JPEG hoặc WebP</div>
          <span className="mt-4 inline-flex h-8 items-center rounded-md border bg-background px-2.5 text-sm font-medium shadow-xs">
            Chọn ảnh
          </span>
        </label>
      ) : (
        <>
          <div className="flex min-h-56 items-center justify-center overflow-auto rounded-xl border bg-muted/20 p-4">
            <ReactCrop
              crop={crop}
              aspect={aspect}
              minWidth={64}
              minHeight={64}
              keepSelection
              disabled={uploading}
              onChange={(_, percentCrop) => onCropChange(percentCrop)}
            >
              <img
                src={previewUrl}
                alt={file?.name ?? 'Xem trước ảnh'}
                className="max-h-[45vh] max-w-full object-contain"
                onLoad={(event) =>
                  onImageLoad(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
                }
                onError={onPreviewError}
              />
            </ReactCrop>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${ownerId}-image-name`} className="mb-2 block text-xs font-medium">
                Tên file
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id={`${ownerId}-image-name`}
                  value={fileNameStem}
                  maxLength={180}
                  disabled={uploading}
                  onChange={(event) => onFileNameChange(event.currentTarget.value)}
                />
                <span className="shrink-0 text-sm text-muted-foreground">
                  .{file ? imageExtension(file) : ''}
                </span>
              </div>
            </div>

            <div>
              <label htmlFor={`${ownerId}-image-aspect`} className="mb-2 block text-xs font-medium">
                Tỉ lệ crop
              </label>
              <select
                id={`${ownerId}-image-aspect`}
                value={aspectPreset}
                disabled={uploading}
                onChange={(event) => changeAspect(event.currentTarget.value as AspectPreset)}
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="free">Tự do</option>
                <option value="original">Ảnh gốc</option>
                <option value="1:1">1:1</option>
                <option value="4:3">4:3</option>
                <option value="3:2">3:2</option>
                <option value="16:9">16:9</option>
              </select>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="min-w-0 text-xs text-muted-foreground">
              {naturalWidth && naturalHeight && (
                <>
                  Gốc {naturalWidth} × {naturalHeight}px
                  {croppedNaturalWidth && croppedNaturalHeight
                    ? ` · Crop ${croppedNaturalWidth} × ${croppedNaturalHeight}px`
                    : ''}
                </>
              )}
            </div>
            <label
              htmlFor={`${ownerId}-image-file`}
              className="inline-flex h-8 shrink-0 cursor-pointer items-center rounded-md border bg-background px-2.5 text-sm font-medium shadow-xs hover:bg-muted"
            >
              Đổi ảnh
            </label>
          </div>
        </>
      )}

      {error && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
