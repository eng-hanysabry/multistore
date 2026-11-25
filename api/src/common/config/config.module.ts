import { Global, Module } from '@nestjs/common';
import { parseConfig } from './app-config';
import { APP_CONFIG } from './config.token';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => parseConfig(process.env) }],
  exports: [APP_CONFIG],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module marker
export class AppConfigModule {}
