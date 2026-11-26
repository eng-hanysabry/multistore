import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks an endpoint as unauthenticated. The server assigns the GUEST role to such
 * requests; a client can never choose a role (spec 6.3).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
