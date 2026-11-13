import { join } from 'node:path';
import { I18nModule, JsonI18nLoader } from '@nestjs/i18n';

export const I18nWorkerModule = I18nModule.forRoot({
  defaultLocale: 'vi',
  supportedLocales: ['vi', 'en'],
  loader: new JsonI18nLoader({ path: join(__dirname, '..', 'i18n') }),
  resolvers: [],
  missingKey: process.env.NODE_ENV === 'production' ? 'fallback' : 'throw',
});
