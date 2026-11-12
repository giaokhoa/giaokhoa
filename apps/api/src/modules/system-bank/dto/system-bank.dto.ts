import {
  createSystemBankQuestionSchema,
  createSystemBankVersionSchema,
  createSystemOutcomePackageSchema,
  discoverSystemBankQuestionsSchema,
  importSystemBankQuestionSchema,
  withdrawSystemBankQuestionSchema,
  type CreateSystemBankQuestion,
  type CreateSystemBankVersion,
  type CreateSystemOutcomePackage,
  type DiscoverSystemBankQuestions,
  type ImportSystemBankQuestion,
  type SystemBankPackage,
  type WithdrawSystemBankQuestion,
} from '@giaokhoa/contracts';

/**
 * Validation của module System Bank dùng Zod qua Standard Schema —
 * schema nền ở `@giaokhoa/contracts` là nguồn sự thật duy nhất.
 */
export {
  createSystemBankQuestionSchema,
  createSystemBankVersionSchema,
  createSystemOutcomePackageSchema,
  discoverSystemBankQuestionsSchema,
  importSystemBankQuestionSchema,
  withdrawSystemBankQuestionSchema,
};
export type CreateSystemBankQuestionDto = CreateSystemBankQuestion;
export type CreateSystemBankVersionDto = CreateSystemBankVersion;
export type WithdrawSystemBankQuestionDto = WithdrawSystemBankQuestion;
export type DiscoverSystemBankQuestionsDto = DiscoverSystemBankQuestions;
export type ImportSystemBankQuestionDto = ImportSystemBankQuestion;
export type CreateSystemOutcomePackageDto = CreateSystemOutcomePackage;
export type SystemBankPackageDto = SystemBankPackage;
