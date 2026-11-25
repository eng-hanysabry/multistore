# Terminology
- **Guest**: unauthenticated visitor, reads published data of one active store.
- **Customer**: signed-in shopper, published catalog plus own rows in the active store.
- **Merchant**: store owner or staff with a membership for the store.
- **Super Admin**: platform operator using the separate `multistore_admin` role and credential, explicit audited tenant parameter.
- **Tenant / store**: one merchant's isolated data, identified by `tenant_id` (UUID).
