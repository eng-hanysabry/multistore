import { SetMetadata } from '@nestjs/common';
import { AppRole } from '../tenancy/tenant-context';

export const ROLES_KEY = 'roles';

/** Restricts an endpoint to the listed verified token roles (spec 6.3). */
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
