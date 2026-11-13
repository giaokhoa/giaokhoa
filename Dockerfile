# syntax=docker/dockerfile:1
# Dockerfile production ở gốc repo — một giai đoạn build dùng chung cho cả ba ứng dụng (api, worker, web) và ba target runtime tương ứng, chọn bằng `--target` (docker compose đã khai sẵn theo từng service).
#
# Cách build giữ đúng cách build monorepo hiện hành: `pnpm install
# --frozen-lockfile` rồi `turbo run build` cho ba app, sau đó đóng gói
# từng app bằng `pnpm deploy --prod` (bản đóng gói tự chứa: dist/build đã biên dịch + node_modules chỉ còn dependency production, gồm cả các package workspace đã biên dịch) để các image runtime không mang theo mã nguồn monorepo và devDependency.
#
# Các image runtime dùng node:24-bookworm-slim cùng họ glibc với image build (bookworm đầy đủ) vì @giaokhoa/api có dependency native argon2 — bản binary biên dịch ở giai đoạn build phải nạp được ở giai đoạn runtime.

# ----- Giai đoạn build dùng chung -----
FROM node:24.22.3-bookworm AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo
# Tải dependency theo lockfile trước khi chép nguồn: sửa code không làm mất layer tải gói; bước install sau chỉ liên kết workspace và chạy build native.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --store-dir /pnpm/store
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --offline --frozen-lockfile --store-dir /pnpm/store
RUN pnpm exec turbo run build --filter=@giaokhoa/api --filter=@giaokhoa/worker --filter=@giaokhoa/web
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @giaokhoa/api deploy --offline --prod --store-dir /pnpm/store /out/api \
  && pnpm --filter @giaokhoa/worker deploy --offline --prod --store-dir /pnpm/store /out/worker \
  && pnpm --filter @giaokhoa/web deploy --offline --prod --store-dir /pnpm/store /out/web

# ----- Runtime API -----
# Tiến trình API NestJS đã biên dịch (dist/main.js). Dữ liệu tệp tải lên nằm ở FILE_STORAGE_DIR (mặc định ./data/files theo cấu hình app) — compose.yaml gắn volume bền vào đúng thư mục này.
FROM node:24.22.3-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/api ./
# Bộ công cụ PostgreSQL 18 (pg_dump/pg_restore) cho các công cụ vận hành đội kho (issue #586): service migrate và các lệnh fleet:* khi vận hành gọi đều chạy trong chính image này. Bản công cụ phải khớp major với server Postgres của stack (18) — pg_dump cũ hơn server từ chối dump. Cài từ kho PGDG chính thức của PostgreSQL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-18 \
  && rm -rf /var/lib/apt/lists/*
# Thư mục dữ liệu thuộc node ngay từ lúc image được dựng: volume rỗng
# gắn lên /app/data sẽ nhận đúng quyền truy cập ở lần khởi tạo đầu.
RUN mkdir -p /app/data/files /app/data/fleet-backups \
  && chown -R node:node /app/data
USER node
EXPOSE 3100
CMD ["node", "dist/main.js"]

# ----- Runtime worker -----
# Tiến trình worker (BullMQ + outbox relay) đã biên dịch (dist/main.js); worker không mở cổng HTTP.
FROM node:24.22.3-bookworm-slim AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/worker ./
RUN mkdir -p /app/data/files && chown -R node:node /app/data
USER node
CMD ["node", "dist/main.js"]

# ----- Runtime web -----
# Server SSR chính thức của React Router chỉ phục vụ trang và asset. Caddy (service gateway) chịu trách nhiệm proxy API/Socket.IO/MCP, CSP và cổng HTTP công khai; tiến trình web không tự proxy nữa.
FROM node:24.22.3-bookworm-slim AS web
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/web ./
USER node
EXPOSE 3000
CMD ["./node_modules/.bin/react-router-serve", "build/server/index.js"]
