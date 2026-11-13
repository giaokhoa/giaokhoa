import { SetMetadata } from '@nestjs/common';
export const SKIP_SPACE_CONTEXT_KEY = 'skipSpaceContext';
export const SkipSpaceContext = () => SetMetadata(SKIP_SPACE_CONTEXT_KEY, true);
