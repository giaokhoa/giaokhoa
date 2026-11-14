import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { forbidden } from '../../common/http-errors';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { DeprecatedRouteAliasInterceptor } from '../../common/deprecated-route-alias.interceptor';
import { CoursesService, type CategoryDeleteMode } from './courses.service';
import { applyCurriculumFrameSchema, copyCourseContentSchema, createCourseCategorySchema, createCourseModuleSchema, createCourseSchema, createCourseSectionSchema, duplicateCourseSchema, reorderCourseModulesSchema, reorderCourseSectionsSchema, updateCourseCategorySchema, updateCourseModuleSchema, updateCourseSchema, updateCourseSectionSchema, type ApplyFrameDto, type CopyContentDto, type CreateCategoryDto, type CreateCmDto, type CreateCourseDto, type CreateSectionDto, type DuplicateCourseDto, type ReorderModulesDto, type ReorderSectionsDto, type UpdateCategoryDto, type UpdateCmDto, type UpdateCourseDto, type UpdateSectionDto, applyBookFrameSchema, type ApplyBookFrameDto } from './dto/courses.dto';

@ApiTags('courses')
@Controller({ path: 'courses', version: '1' })
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Post('categories')
  async createCategory(@Body({ schema: createCourseCategorySchema }) dto: CreateCategoryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.courses.createCategory(actor.id, dto);
  }
  @Get('categories')
  async listCategories() { return this.courses.listCategories(); }
  @Get('categories/tree')
  async categoryTree(@CurrentUser() actor: AuthenticatedUser) { return this.courses.categoryTreeFor(actor.id); }
  @Get('categories/:id')
  async getCategory(@Param('id', { schema: uuidIdSchema }) id: string) { return this.courses.getCategory(id); }
  @Patch('categories/:id')
  async updateCategory(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: updateCourseCategorySchema }) dto: UpdateCategoryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.courses.updateCategory(actor.id, id, dto);
  }
  @Delete('categories/:id')
  async deleteCategory(@Param('id', { schema: uuidIdSchema }) id: string, @Query('mode') mode: string | undefined, @CurrentUser() actor: AuthenticatedUser) {
    const parsed = mode === undefined ? undefined : (mode as CategoryDeleteMode);
    if (parsed !== undefined && parsed !== 'moveup' && parsed !== 'recursive') {
      forbidden(`Unknown category delete mode ${mode} (expected moveup|recursive)`, 'course.category_bad_mode');
    }
    return this.courses.deleteCategory(actor.id, id, parsed);
  }

  @Post()
  async create(@Body({ schema: createCourseSchema }) dto: CreateCourseDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.courses.createCourse(actor.id, dto);
  }
  @Get()
  async list(@CurrentUser() actor: AuthenticatedUser, @Query('category') category?: string) {
    return this.courses.listCoursesFor(actor.id, category || undefined);
  }
  @Get('templates')
  async templates(@CurrentUser() actor: AuthenticatedUser) {
    return this.courses.listTemplates(actor.id);
  }
  @Post(':id/copy')
  async copy(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: duplicateCourseSchema }) dto: DuplicateCourseDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.courses.duplicateCourse(actor.id, id, dto);
  }
  @Post(':id/duplicate')
  @UseInterceptors(DeprecatedRouteAliasInterceptor)
  async duplicate(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: duplicateCourseSchema }) dto: DuplicateCourseDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.copy(id, dto, actor);
  }
  @Post(':id/import-content')
  async importContent(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: copyCourseContentSchema }) dto: CopyContentDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.courses.copyCourseContent(actor.id, id, dto);
  }
  @Post(':id/reorder-sections')
  async reorderSections(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: reorderCourseSectionsSchema }) dto: ReorderSectionsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.courses.reorderSections(actor.id, id, dto.sectionIds);
  }
  @Get(':id')
  async get(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() viewer: AuthenticatedUser) {
    const course = await this.courses.assertCourseAccess(viewer.id, id);
    return { ...course, contextId: await this.courses.courseContextId(id), customFields: await this.courses.getCourseCustomFields(id), formatOptions: await this.courses.getFormatOptions(id) };
  }
  @Get(':id/content')
  async content(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() viewer: AuthenticatedUser) {
    return this.courses.getCourseContent(viewer.id, id);
  }
  @Post(':id/curriculum-frame')
  async applyFrame(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: applyCurriculumFrameSchema }) dto: ApplyFrameDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.courses.applyCurriculumFrame(actor.id, id, dto);
  }
  @Post(':id/book-frame')
  async applyBookFrame(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: applyBookFrameSchema }) dto: ApplyBookFrameDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.courses.applyBookFrame(actor.id, id, dto);
  }
  @Patch(':id')
  async update(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: updateCourseSchema }) dto: UpdateCourseDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.courses.updateCourse(actor.id, id, dto);
  }
  @Delete(':id')
  async remove(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.courses.deleteCourse(actor.id, id);
    return { deleted: true };
  }

  @Post(':id/sections')
  async createSection(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: createCourseSectionSchema }) dto: CreateSectionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.courses.createSection(actor.id, id, dto);
  }
  @Patch(':id/sections/:sectionId')
  async updateSection(@Param('sectionId', { schema: uuidIdSchema }) sectionId: string, @Body({ schema: updateCourseSectionSchema }) dto: UpdateSectionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.courses.updateSection(actor.id, sectionId, dto);
  }
  @Delete(':id/sections/:sectionId')
  async deleteSection(@Param('sectionId', { schema: uuidIdSchema }) sectionId: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.courses.deleteSection(actor.id, sectionId);
    return { deleted: true };
  }
  @Post(':id/sections/:sectionId/copy')
  async copySection(@Param('sectionId', { schema: uuidIdSchema }) sectionId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.courses.duplicateSection(actor.id, sectionId);
  }
  @Post(':id/sections/:sectionId/duplicate')
  @UseInterceptors(DeprecatedRouteAliasInterceptor)
  async duplicateSection(@Param('sectionId', { schema: uuidIdSchema }) sectionId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.copySection(sectionId, actor);
  }
  @Post(':id/sections/:sectionId/reorder-modules')
  async reorderModules(@Param('sectionId', { schema: uuidIdSchema }) sectionId: string, @Body({ schema: reorderCourseModulesSchema }) dto: ReorderModulesDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.courses.reorderModules(actor.id, sectionId, dto.moduleIds);
  }
  @Get(':id/sections/:sectionId/access')
  async sectionAccess(@Param('id', { schema: uuidIdSchema }) id: string, @Param('sectionId', { schema: uuidIdSchema }) sectionId: string, @CurrentUser() viewer: AuthenticatedUser) {
    await this.courses.assertCourseAccess(viewer.id, id);
    const section = await this.courses.getSection(sectionId);
    const result = await this.courses.checkSectionAccess(viewer.id, section);
    if (!result.available) forbidden('This section is not available to you yet', 'availability.not_available');
    return { sectionId, available: true };
  }

  @Post(':id/modules')
  async createCm(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: createCourseModuleSchema }) dto: CreateCmDto, @CurrentUser() actor: AuthenticatedUser) {
    const cm = await this.courses.createCm(actor.id, id, dto);
    return { ...cm, contextId: await this.courses.cmContextId(cm.id) };
  }
  @Get(':id/modules/:cmId')
  async getCm(@Param('id', { schema: uuidIdSchema }) id: string, @Param('cmId', { schema: uuidIdSchema }) cmId: string, @CurrentUser() viewer: AuthenticatedUser) {
    await this.courses.assertCourseAccess(viewer.id, id);
    const cm = await this.courses.getCm(cmId);
    return { ...cm, contextId: await this.courses.cmContextId(cm.id) };
  }
  @Get(':id/modules/:cmId/access')
  async cmAccess(@Param('id', { schema: uuidIdSchema }) id: string, @Param('cmId', { schema: uuidIdSchema }) cmId: string, @CurrentUser() viewer: AuthenticatedUser) {
    await this.courses.assertCourseAccess(viewer.id, id);
    const cm = await this.courses.getCm(cmId);
    const result = await this.courses.checkCmAccess(viewer.id, cm);
    if (!result.available) forbidden('This activity is not available to you yet', 'availability.not_available');
    return { cmId, available: true };
  }
  @Post(':id/modules/:cmId/copy')
  async copyCm(@Param('cmId', { schema: uuidIdSchema }) cmId: string, @CurrentUser() actor: AuthenticatedUser) {
    const cm = await this.courses.duplicateCm(actor.id, cmId);
    return { ...cm, contextId: await this.courses.cmContextId(cm.id) };
  }
  @Post(':id/modules/:cmId/duplicate')
  @UseInterceptors(DeprecatedRouteAliasInterceptor)
  async duplicateCm(@Param('cmId', { schema: uuidIdSchema }) cmId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.copyCm(cmId, actor);
  }
  @Post(':id/modules/:cmId/view')
  async viewCm(@Param('cmId', { schema: uuidIdSchema }) cmId: string, @CurrentUser() viewer: AuthenticatedUser) {
    const cm = await this.courses.recordCmView(viewer.id, cmId);
    return { cmId: cm.id, viewed: true };
  }
  @Patch(':id/modules/:cmId')
  async updateCm(@Param('cmId', { schema: uuidIdSchema }) cmId: string, @Body({ schema: updateCourseModuleSchema }) dto: UpdateCmDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.courses.updateCm(actor.id, cmId, dto);
  }
  @Delete(':id/modules/:cmId')
  async deleteCm(@Param('cmId', { schema: uuidIdSchema }) cmId: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.courses.deleteCm(actor.id, cmId);
    return { deleted: true };
  }
}
