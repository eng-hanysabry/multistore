import { AppRole } from './tenant-context';

/**
 * Merchant membership re-check (spec 6.3 rule 2, 6.7): for MERCHANT endpoints the
 * application checks the memberships table, so a forged or stale role claim does not
 * pass the application layer. Returns the membership role or null.
 */
export interface MembershipChecker {
  membershipRole(userId: string, tenantId: string): Promise<AppRole | null>;
}

export const MEMBERSHIP_CHECKER = Symbol('MEMBERSHIP_CHECKER');
