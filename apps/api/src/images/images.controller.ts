import { ImagesService, type UploadedImageFile } from '@giaokhoa/application/images/service';
import type { TikzImageSource } from '@giaokhoa/shared/images';
import {
  imagesContract,
  type DiscardImagesBody,
  type UploadedImageResponse,
  type UploadImageBody,
} from '@giaokhoa/shared/http/images';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import type { Response } from 'express';

@Controller('images')
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor(imagesContract.upload.file.field, {
      limits: { files: 1, fileSize: imagesContract.upload.file.maxBytes },
    }),
  )
  async upload(
    @UploadedFile() file: UploadedImageFile | undefined,
    @Body({ schema: imagesContract.upload.body }) body: UploadImageBody,
    @Session() session: UserSession,
  ): Promise<UploadedImageResponse> {
    return this.toResponse(await this.images.createImage(file, session.user.id, body));
  }

  @Post('discard')
  @HttpCode(HttpStatus.NO_CONTENT)
  discard(
    @Body({ schema: imagesContract.discard.body }) body: DiscardImagesBody,
    @Session() session: UserSession,
  ) {
    return this.images.discardImages(body.images, session.user.id);
  }

  @Post(':id/variants')
  @UseInterceptors(
    FileInterceptor(imagesContract.uploadVariant.file.field, {
      limits: { files: 1, fileSize: imagesContract.uploadVariant.file.maxBytes },
    }),
  )
  async uploadVariant(
    @Param('id', { schema: imagesContract.uploadVariant.pathParams.shape.id }) id: string,
    @UploadedFile() file: UploadedImageFile | undefined,
    @Session() session: UserSession,
  ): Promise<UploadedImageResponse> {
    return this.toResponse(await this.images.createImageVariant(id, file, session.user.id));
  }

  @Get(':id/variants/:imageVariantId')
  @Header('Cache-Control', 'private, max-age=31536000, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  async getVariant(
    @Param('id', { schema: imagesContract.getVariant.pathParams.shape.id }) id: string,
    @Param('imageVariantId', {
      schema: imagesContract.getVariant.pathParams.shape.imageVariantId,
    })
    imageVariantId: string,
    @Res() response: Response,
  ) {
    this.sendImage(response, await this.images.getImageVariant(id, imageVariantId));
  }

  @Get(':id/source')
  @Header('Cache-Control', 'private, no-store')
  async getSource(
    @Param('id', { schema: imagesContract.getSource.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<TikzImageSource> {
    return imagesContract.getSource.responses[200].parse(
      await this.images.getImageSource(id, session.user.id),
    );
  }

  @Get(':id')
  @Header('Cache-Control', 'private, max-age=31536000, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  async get(
    @Param('id', { schema: imagesContract.get.pathParams.shape.id }) id: string,
    @Res() response: Response,
  ) {
    this.sendImage(response, await this.images.getImage(id));
  }

  private toResponse(image: {
    imageId: string;
    imageVariantId: string | null;
    width: number;
    height: number;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
  }): UploadedImageResponse {
    const src = image.imageVariantId
      ? `/images/${image.imageId}/variants/${image.imageVariantId}`
      : `/images/${image.imageId}`;
    return imagesContract.upload.responses[201].parse({ ...image, src });
  }

  private sendImage(
    response: Response,
    image: { body: Uint8Array; mimeType: string; byteSize: number; etag?: string },
  ) {
    response.type(image.mimeType);
    response.setHeader('Content-Length', image.byteSize);
    if (image.mimeType === 'image/svg+xml') {
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      );
    }
    if (image.etag) response.setHeader('ETag', image.etag);
    response.send(Buffer.from(image.body));
  }
}
