# Decision 0002 Phase 1 Authentication and Groups

Status: accepted implementation baseline on 2026-09-12

## Decision

Use Supabase email-and-password authentication with cookie-based server-rendered sessions. Store application profile data separately from Supabase Auth and never copy email addresses into public application tables.

Model group membership as many-to-many immediately. Give each private group one immutable owner and support owner, admin, and member roles. Owners alone may change roles. Owners and admins may create or revoke invitations; admins may remove members, owners may remove any non-owner, and non-owners may leave voluntarily.

Use random expiring invite tokens that are returned as plaintext only at creation and persisted only as SHA-256 hashes. Join membership only through an audited database function that locks and consumes a valid token. Do not grant direct authenticated writes to the membership or invitation tables.

Allow profiles to be private or visible to shared-group members. Keep the proposed default-bankroll and preferred-unit fields nullable and add no bankroll behavior in Phase 1.

## Reasons

- Email and password is the simplest complete method explicitly allowed by the user and governing source.
- Server-readable cookies support authenticated App Router pages while Supabase Auth remains the identity authority.
- A join table satisfies multi-group architecture without a future schema rewrite.
- A single immutable owner avoids ambiguous ownership transfer and role escalation during the security-proving phase.
- Hashed, expiring, limited-use tokens avoid storing bearer credentials in readable group rows.
- Security-definer functions provide narrow administrative operations while Row Level Security denies direct privilege escalation.
- Nullable future-facing preferences preserve the source's proposed fields without inventing Phase 3 bankroll rules.

## Consequences

Signup availability is controlled by the Supabase project configuration; this phase does not add a second application-admission system. A project that requires invitation-only account creation must make that later owner decision separately from private-group admission.

Email confirmation behavior is also controlled by Supabase Auth configuration. The interface handles both an immediate session and a confirmation-required response.

Ownership transfer, reusable permanent invite links, public profiles, application-wide administrators, and complex moderation are not implemented. Adding any of them requires a later explicit decision, migration, authorization tests, and security review.
