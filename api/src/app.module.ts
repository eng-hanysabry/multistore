import { Module } from '@nestjs/common';

/** Foundation shell only. Feature modules arrive in later phases (IP-4 onward). */
@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module marker
export class AppModule {}
