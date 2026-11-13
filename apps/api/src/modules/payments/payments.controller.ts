import { Body, Controller, Get, Headers, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { Public } from '../../common/public.decorator';
import { createCouponSchema, createPaymentAccountSchema, createPaymentSchema, createRefundSchema, paymentWebhookSchema, purchasePlanSchema, rejectRefundSchema, resolvePaymentReviewSchema, settleRefundSchema, updateCouponSchema, type CreateAccountDto, type CreateCouponDto, type CreatePaymentDto, type PurchasePlanDto, type RefundDto, type RejectRefundDto, type ResolvePaymentReviewDto, type SettleRefundDto, type UpdateCouponDto, type WebhookDto } from './dto/payments.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller({ path: 'payments', version: '1' })
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}
  @Post('accounts')
  async createAccount(@Body({ schema: createPaymentAccountSchema }) dto: CreateAccountDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.createAccount(actor.id, dto);
  }
  @Get('accounts')
  async listAccounts(@CurrentUser() actor: AuthenticatedUser) { return this.payments.listAccounts(actor.id); }
  @Get('accounts/:id')
  async getAccount(@Param('id', { schema: uuidIdSchema }) id: string) { return this.payments.getAccount(id); }
  @Post()
  async create(@Body({ schema: createPaymentSchema }) dto: CreatePaymentDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.createPayment(actor.id, dto);
  }
  @Post('fee/:instanceId')
  async createFee(@Param('instanceId', { schema: uuidIdSchema }) instanceId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.createFeePayment(actor.id, instanceId);
  }
  @Post('class-fee/:classId')
  async createClassFee(@Param('classId', { schema: uuidIdSchema }) classId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.createClassFeePayment(actor.id, classId);
  }
  @Post('plans')
  async purchasePlan(@Body({ schema: purchasePlanSchema }) dto: PurchasePlanDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.createPlanPayment(actor.id, dto);
  }
  @Post('coupons')
  async createCoupon(@Body({ schema: createCouponSchema }) dto: CreateCouponDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.createCoupon(actor.id, dto);
  }
  @Get('coupons')
  async listCoupons(@CurrentUser() actor: AuthenticatedUser) { return this.payments.listCoupons(actor.id); }
  @Get('coupons/:id')
  async getCoupon(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.getCoupon(actor.id, id);
  }
  @Patch('coupons/:id')
  async updateCoupon(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: updateCouponSchema }) dto: UpdateCouponDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.updateCoupon(actor.id, id, dto);
  }
  @Get('plans/me')
  async myPlans(@CurrentUser() actor: AuthenticatedUser) { return this.payments.listMyPlanEntitlements(actor.id); }
  @Get('me')
  async mine(@CurrentUser() actor: AuthenticatedUser) { return this.payments.listPaymentsForUser(actor.id); }
  @Get('review-queue')
  async reviewQueue(@CurrentUser() actor: AuthenticatedUser) { return this.payments.listReviewQueue(actor.id); }
  @Get(':id')
  async get(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) { return this.payments.getPaymentForUser(actor.id, id); }
  @Get(':id/refunds')
  async refunds(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) { return this.payments.listRefundsForUser(actor.id, id); }
  @Post(':id/refunds')
  async createRefund(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: createRefundSchema }) dto: RefundDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.createRefund(actor.id, id, dto);
  }
  @Post(':id/refunds/:refundId/approve')
  async approveRefund(@Param('id', { schema: uuidIdSchema }) id: string, @Param('refundId', { schema: uuidIdSchema }) refundId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.approveRefund(actor.id, id, refundId);
  }
  @Post(':id/refunds/:refundId/reject')
  async rejectRefund(@Param('id', { schema: uuidIdSchema }) id: string, @Param('refundId', { schema: uuidIdSchema }) refundId: string, @Body({ schema: rejectRefundSchema }) dto: RejectRefundDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.rejectRefund(actor.id, id, refundId, dto);
  }
  @Post(':id/refunds/:refundId/settle')
  async settleRefund(@Param('id', { schema: uuidIdSchema }) id: string, @Param('refundId', { schema: uuidIdSchema }) refundId: string, @Body({ schema: settleRefundSchema }) dto: SettleRefundDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.settleRefund(actor.id, id, refundId, dto);
  }
  @Post(':id/review')
  async resolveReview(@Param('id', { schema: uuidIdSchema }) id: string, @Body({ schema: resolvePaymentReviewSchema }) dto: ResolvePaymentReviewDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.resolvePaymentReview(actor.id, id, dto);
  }
  @Public()
  @Post('webhook')
  async webhook(@Body({ schema: paymentWebhookSchema }) dto: WebhookDto, @Headers() headers: Record<string, string | string[] | undefined>) {
    return this.payments.handleWebhook({ gateway: dto.gateway, externalTransactionId: dto.externalTransactionId, paymentId: dto.paymentId, status: dto.status }, headers);
  }
  @Public()
  @Post('ipn/sepay')
  async sepayIpn(@Req() req: Request) {
    return this.payments.handleSepayIpn({
      ip: req.ip,
      authorization: req.headers.authorization,
      body: (req as { body?: unknown }).body,
    });
  }
}
