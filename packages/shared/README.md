# Shared contracts and schemas

`@giaokhoa/shared` contains framework- and infrastructure-free code that is reused across
the web, editor, API, application services, database adapters, and future MCP runtime.

Public domain subpaths are bounded-context oriented:

- `@giaokhoa/shared/questions`
- `@giaokhoa/shared/curriculum`
- `@giaokhoa/shared/images`

HTTP descriptors are transport-specific subpaths:

- `@giaokhoa/shared/http/questions`
- `@giaokhoa/shared/http/stimuli`
- `@giaokhoa/shared/http/subjects`
- `@giaokhoa/shared/http/curricula`
- `@giaokhoa/shared/http/curriculum-nodes`
- `@giaokhoa/shared/http/learning-outcomes`
- `@giaokhoa/shared/http/images`
- `@giaokhoa/shared/http/auth`

Domain schemas use semantic names such as `questionCreateSchema`, `questionPatchSchema`,
and `questionSchema`. HTTP descriptors reuse those schemas directly when the wire shape is the
same instead of creating transport aliases.

This package must not import NestJS, React, Drizzle, PostgreSQL code, `@giaokhoa/application`,
or `@giaokhoa/database`.
