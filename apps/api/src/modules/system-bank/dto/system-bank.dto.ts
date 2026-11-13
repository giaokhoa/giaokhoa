import {
  createSystemBankQuestionSchema,
  createSystemBankVersionSchema,
  createSystemOutcomePackageSchema,
  rejectSystemOutcomePackageSchema,
  discoverSystemBankQuestionsSchema,
  importSystemBankQuestionSchema,
  withdrawSystemBankQuestionSchema,
  type CreateSystemBankQuestion,
  type CreateSystemBankVersion,
  type CreateSystemOutcomePackage,
  type RejectSystemOutcomePackage,
  type DiscoverSystemBankQuestions,
  type ImportSystemBankQuestion,
  type SystemBankPackage,
  type WithdrawSystemBankQuestion,
} from '@giaokhoa/contracts';

export {
  createSystemBankQuestionSchema,
  createSystemBankVersionSchema,
  createSystemOutcomePackageSchema,
  rejectSystemOutcomePackageSchema,
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
export type RejectSystemOutcomePackageDto = RejectSystemOutcomePackage;
export type SystemBankPackageDto = SystemBankPackage;
