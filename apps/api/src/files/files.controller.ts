import { FilesService, type UploadedFile as FileUpload } from '@giaokhoa/application/files/service';
import { fileUrl, type FileMimeType, type TikzFileSource } from '@giaokhoa/shared/files';
import {
  filesContract,
  type DiscardFilesBody,
  type UploadedFileResponse,
  type UploadFileBody,
} from '@giaokhoa/shared/http/files';
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

@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** Tạo file ảnh nháp; đường dẫn trả về chỉ định danh logic, không lộ S3. */
  @Post()
  @UseInterceptors(
    FileInterceptor(filesContract.upload.file.field, {
      limits: { files: 1, fileSize: filesContract.upload.file.maxBytes },
    }),
  )
  async upload(
    @UploadedFile() file: FileUpload | undefined,
    @Body({ schema: filesContract.upload.body }) body: UploadFileBody,
    @Session() session: UserSession,
  ): Promise<UploadedFileResponse> {
    return this.toResponse(await this.files.createFile(file, session.user.id, body));
  }

  /** Dọn file nháp không được tài nguyên nào tham chiếu. */
  @Post('discard')
  @HttpCode(HttpStatus.NO_CONTENT)
  discard(
    @Body({ schema: filesContract.discard.body }) body: DiscardFilesBody,
    @Session() session: UserSession,
  ) {
    return this.files.discardFiles(body.files, session.user.id);
  }

  /** Tạo một file crop có quan hệ với bản gốc. */
  @Post(':id/variants')
  @UseInterceptors(
    FileInterceptor(filesContract.uploadVariant.file.field, {
      limits: { files: 1, fileSize: filesContract.uploadVariant.file.maxBytes },
    }),
  )
  async uploadVariant(
    @Param('id', { schema: filesContract.uploadVariant.pathParams.shape.id }) id: string,
    @UploadedFile() file: FileUpload | undefined,
    @Session() session: UserSession,
  ): Promise<UploadedFileResponse> {
    return this.toResponse(await this.files.createVariant(id, file, session.user.id));
  }

  /** Phục vụ đúng crop được phép xem theo ngữ cảnh bài giao. */
  @Get(':id/variants/:variantId')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async getVariant(
    @Param('id', { schema: filesContract.getVariant.pathParams.shape.id }) id: string,
    @Param('variantId', { schema: filesContract.getVariant.pathParams.shape.variantId })
    variantId: string,
    @Session() session: UserSession,
    @Res() response: Response,
  ) {
    this.sendFile(response, await this.files.getVariant(id, variantId, session.user.id));
  }

  /** Chỉ chủ sở hữu đọc nguồn TikZ; người nhận bài không được đọc. */
  @Get(':id/source')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async getSource(
    @Param('id', { schema: filesContract.getSource.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<TikzFileSource> {
    return filesContract.getSource.responses[200].parse(
      await this.files.getSource(id, session.user.id),
    );
  }

  /** Trả bytes sau khi application kiểm tra owner hoặc quyền xem bài giao. */
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async get(
    @Param('id', { schema: filesContract.get.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
    @Res() response: Response,
  ) {
    this.sendFile(response, await this.files.getFile(id, session.user.id));
  }

  private toResponse(file: {
    fileId: string;
    variantFileId: string | null;
    width: number;
    height: number;
    mimeType: FileMimeType;
  }): UploadedFileResponse {
    return filesContract.upload.responses[201].parse({ ...file, src: fileUrl(file) });
  }

  /** Không tin vào MIME từ client; service đã kiểm tra bytes và làm sạch SVG. */
  private sendFile(
    response: Response,
    file: { body: Uint8Array; mimeType: string; byteSize: number; etag?: string },
  ) {
    response.type(file.mimeType);
    response.setHeader('Content-Length', file.byteSize);
    if (file.mimeType === 'image/svg+xml') {
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      );
    }
    if (file.etag) response.setHeader('ETag', file.etag);
    response.send(Buffer.from(file.body));
  }
}
