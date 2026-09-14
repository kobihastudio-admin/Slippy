# Security Architecture

## Trust Boundaries

- Web sessions: Supabase Auth cookies plus organization membership checks.
- Fastify internal APIs: `x-internal-key`.
- Stripe and LINE webhooks: provider signature verification.
- LIFF APIs: LINE access token verification through LINE Profile API.
- Database: RLS for authenticated client access; service role only on servers.

## LIFF Authentication Contract

Private routes under `/api/liff/*` require:

```http
Authorization: Bearer <LIFF access token>
```

Middleware validates the token and sets
`x-slippy-verified-line-user-id` internally. Incoming values for that header
are removed. Mutation routes call `getVerifiedLineUserId()` and reject body or
form identities that do not match.

Public exceptions:

- `/api/liff/bill-info`
- `/api/liff/join-split`
- `/api/liff/join-trip`

The join routes still verify the token whenever a request claims a LINE user.
Manual joins are stored as non-LINE participants and must never synthesize a
fake LINE user ID.

## Database Authorization

Migration `055_recent_features_security.sql` enables RLS for recent scanner,
trip, community, friendship, chat, and payment tables. Chat membership checks
use a `SECURITY DEFINER` function with a fixed search path to avoid recursive
RLS policies.

## Required Release Checks

```bash
npm run typecheck -w web
npm run test:security -w web
npm run build -w api
npm run typecheck --prefix mobile
supabase db push --dry-run
```

Production deployment must stop if migration validation or a compile check
fails.
