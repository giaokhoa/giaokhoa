import { join } from 'node:path';
import {
  AcceptLanguageLocaleResolver,
  CookieLocaleResolver,
  HeaderLocaleResolver,
  I18nModule,
  JsonI18nLoader,
  QueryLocaleResolver,
} from '@nestjs/i18n';

export const I18nFoundationModule = I18nModule.forRoot({
  defaultLocale: 'vi',
  supportedLocales: ['vi', 'en'],
  loader: new JsonI18nLoader({ path: join(__dirname, '..', 'i18n') }),
  resolvers: [
    new QueryLocaleResolver('lang'),
    new HeaderLocaleResolver('x-lang'),
    new AcceptLanguageLocaleResolver(),
    new CookieLocaleResolver('lang'),
  ],
  missingKey: process.env.NODE_ENV === 'production' ? 'fallback' : 'throw',
});
