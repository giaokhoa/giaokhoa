import {
  callExternalFunctionSchema,
  createExternalServiceSchema,
  createExternalTokenSchema,
  setExternalServiceEnabledSchema,
  type CallExternalFunction,
  type CreateExternalService,
  type CreateExternalToken,
  type SetExternalServiceEnabled,
} from '@giaokhoa/contracts';

export { callExternalFunctionSchema, createExternalServiceSchema, createExternalTokenSchema, setExternalServiceEnabledSchema };
export type CreateServiceDto = CreateExternalService;
export type CreateTokenDto = CreateExternalToken;
export type CallFunctionDto = CallExternalFunction;
export type SetEnabledDto = SetExternalServiceEnabled;
