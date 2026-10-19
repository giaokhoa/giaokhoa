# Repository conventions for coding agents

These rules are architectural constraints, not suggestions.

## Package responsibilities

- `@giaokhoa/shared` is the framework- and infrastructure-free shared vocabulary.
  It owns canonical Zod schemas, inferred types, constants, and HTTP protocol descriptors.
- `@giaokhoa/application` owns business use cases, domain/application errors, and repository ports.
  It depends on `@giaokhoa/shared` and must not depend on NestJS, Drizzle, or PostgreSQL.
- `@giaokhoa/database` owns Drizzle schema, migrations, persistence types, and PostgreSQL repository
  adapters. It implements repository ports from `@giaokhoa/application`.
- `apps/api` is an HTTP/Nest adapter. Controllers use `@giaokhoa/shared/http/*` for route contracts,
  inject application services, and do not query Drizzle tables directly.
- `apps/mcp` may be added as a separate runtime. It must compose the same application services and
  database adapters rather than implementing its own persistence logic.
- Web and editor packages may depend on `@giaokhoa/shared`, but never on application or database packages.

Dependency direction:

```text
@giaokhoa/shared
       ↑
@giaokhoa/application
       ↑
@giaokhoa/database

apps compose application + database at their runtime boundary
```

`@giaokhoa/database` also depends directly on `@giaokhoa/shared` when it validates persistence rows
against canonical schemas.

## Shared package

Public domain subpaths are bounded-context oriented:

```text
@giaokhoa/shared/questions
@giaokhoa/shared/curriculum
@giaokhoa/shared/images
```

HTTP descriptors are transport-specific:

```text
@giaokhoa/shared/http/questions
@giaokhoa/shared/http/stimuli
@giaokhoa/shared/http/subjects
@giaokhoa/shared/http/curricula
@giaokhoa/shared/http/curriculum-nodes
@giaokhoa/shared/http/learning-outcomes
@giaokhoa/shared/http/images
@giaokhoa/shared/http/auth
```

Do not create a root `@giaokhoa/shared` export. Public entries are explicit package exports.

Canonical schemas use semantic names:

```text
questionSchema
questionCreateSchema
questionPatchSchema
subjectSchema
subjectCreateSchema
subjectPatchSchema
```

When an HTTP body/response has the same shape as a canonical schema, the HTTP descriptor uses the
canonical schema directly. Do not create aliases such as `CreateQuestionBody` or
`questionResponseSchema` only to rename an identical shape.

Use `schema.ts` (singular) for a schema module. Avoid parallel `schema.ts` / `schemas.ts` conventions.
Use singular responsibility filenames such as `service.ts`, `repository.ts`, or direct public entry files
such as `questions.ts`. Do not add resource-level `index.ts` barrels merely to re-export neighboring files.

## Application package

Application services contain behavior shared by every transport:

- ownership checks
- merge-and-revalidate behavior
- question lifecycle rules
- curriculum tree validation
- domain/application errors

Repository interfaces live with the application behavior that consumes them.
Persistence-specific errors such as PostgreSQL error codes must be translated by database adapters into
application errors.

## Application client errors

Client-caused application failures use the single `ClientError` type from
`@giaokhoa/application/client-error`.

- `kind` is one of `invalid`, `not_found`, or `conflict`.
- `code` is a stable domain-specific machine-readable code.
- `message` is the human-readable explanation.
- `details` is optional structured context such as validation issues.
- Do not create per-resource error subclasses or `errors.ts` files just to map one case to HTTP.
- Transport adapters map `ClientError.kind` to their own protocol semantics.

## Database package

`@giaokhoa/database` is the persistence source of truth.

- Runtime Drizzle tables live in `src/schema/*.ts`.
- Migrations and Drizzle tooling are owned by `packages/database`.
- PostgreSQL adapters are named `Postgres{Context}Repository`.
- Runtime application code outside `@giaokhoa/database` must not issue Drizzle queries directly.
- The API composition root may import the database schema to initialize Drizzle, but controllers and
  application services must not import runtime tables.
- Adding an internal database column must never automatically expose it through a shared canonical schema.

## HTTP descriptors

HTTP resource registries remain named `<resource>Contract`, for example `questionsContract`.
Allowed operation vocabulary is `method`, `path`, `pathParams`, `query`, `headers`, `body`,
`file`, and `responses`.

- Use `responses` keyed by HTTP status.
- Use `204: null` for no-body success.
- Use `'binary'` for binary responses.
- Paths are full public API paths.

## Required verification

After changing package boundaries, persistence, shared schemas, or HTTP descriptors, run:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @giaokhoa/api test:e2e
git diff --check
```

`packages/shared/test/http-contracts.spec.ts` enforces the HTTP descriptor convention.
