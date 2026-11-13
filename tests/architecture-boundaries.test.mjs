import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = path.join(root, "packages");
const featureDir = path.join(root, "apps/web/src/features");
const extensions = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

/**
 * Các cặp import ngang runtime được cho phép từ baseline đã phê duyệt của
 * feature-based web (issue #500). Không thêm cặp mới để hợp thức hoá mã mới:
 * khi thay đổi nghiệp vụ cần phê duyệt cập nhật ranh giới ở cấp issue.
 */
const frozenRuntimeEdges = new Set([
  "admin-curriculum>matrices",
  "content-bank>courses",
  "course-builder>content-bank",
  "course-builder>courses",
  "courses>classes",
  "courses>messaging",
  "curriculum>admin-curriculum",
  "curriculum>courses",
  "dashboard>admin",
  "dashboard>badges",
  "dashboard>calendar",
  "dashboard>courses",
  "exams>course-builder",
  "exams>progress-report",
  "exams>questions",
  "guardians>admin",
  "guardians>classes",
  "matrices>courses",
  "matrices>questions",
  "question-editor>matrices",
  "question-editor>questions",
  "questions>course-builder",
  "questions>progress-report",
  "quizzes>progress-report",
  "settings>notifications",
]);

/** Năm cặp chỉ có trong spec (gồm cạnh từng có runtime), không cấp phép chuyển sang runtime. */
const frozenSpecOnlyEdges = new Set([
  "auth>profile",
  "questions>content-bank",
  "questions>exams",
  "questions>question-editor",
  "questions>matrices",
]);

/**
 * Driver E2E của API dựng các processor worker thật trong test; đóng băng
 * chính xác từng import này, tuyệt đối không cho đường tương tự vào runtime.
 */
const frozenCrossAppTestImports = new Set([
  "apps/api/test/e2e/event-log/worker-relay-driver-cleanup.e2e-spec.ts>apps/worker/src/config/env",
  "apps/api/test/e2e/event-log/worker-relay-driver-cleanup.e2e-spec.ts>apps/worker/src/outbox-event-routes",
  "apps/api/test/support/sepay-sweep-driver.ts>apps/worker/src/cohort-sync.service",
  "apps/api/test/support/sepay-sweep-driver.ts>apps/worker/src/sepay-matching.scheduler",
  "apps/api/test/support/sepay-sweep-driver.ts>apps/worker/src/db/routing/space-database.service",
  "apps/api/test/support/sepay-sweep-driver.ts>apps/worker/src/db/tenant-pool",
  "apps/api/test/support/sepay-sweep-driver.ts>apps/worker/src/worker-enrol-outbox.service",
  "apps/api/test/support/sepay-sweep-driver.ts>apps/worker/src/worker-paid-class-enrol-activation.service",
  "apps/api/test/support/sepay-sweep-driver.ts>apps/worker/src/worker-paid-enrol-activation.service",
  "apps/api/test/support/sepay-sweep-driver.ts>apps/worker/src/worker-payment-settlement.service",
  "apps/api/test/support/sepay-sweep-driver.ts>apps/worker/src/worker-payment-space-scope.service",
  "apps/api/test/support/worker-relay-driver.ts>apps/worker/src/config/env",
  "apps/api/test/support/worker-relay-driver.ts>apps/worker/src/db/tenant-als",
  "apps/api/test/support/worker-relay-driver.ts>apps/worker/src/db/tenant-pool",
  "apps/api/test/support/worker-relay-driver.ts>apps/worker/src/event-log-writer.service",
  "apps/api/test/support/worker-relay-driver.ts>apps/worker/src/task-log.service",
  "apps/api/test/support/worker-relay-driver.ts>apps/worker/src/db/routing/space-database.service",
  "apps/api/test/support/worker-relay-driver.ts>apps/worker/src/outbox-relay.scheduler",
  "apps/api/test/support/worker-relay-driver.ts>apps/worker/src/outbox-event-routes",
]);

function* codeFiles(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      ["node_modules", "dist", "build", ".turbo", ".react-router"].includes(
        entry.name,
      )
    )
      continue;
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* codeFiles(next);
    else if (entry.isFile() && extensions.has(path.extname(next))) yield next;
  }
}

/** Đọc chính cú pháp import/export/dynamic import, bỏ qua comment và chuỗi không phải module. */
function importSpecifiers(filename, code = readFileSync(filename, "utf8")) {
  const kind =
    filename.endsWith(".tsx") || filename.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;
  const ast = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const imports = [];
  function collect(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      imports.push(node.moduleReference.expression.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")
      ) {
        imports.push(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, collect);
  }
  collect(ast);
  return imports;
}

function featureTarget(file, specifier) {
  let target;
  if (specifier.startsWith("#features/")) {
    target = specifier.substring("#features/".length).split("/")[0];
  } else if (specifier.startsWith(".")) {
    const destination = path.resolve(
      path.dirname(file),
      specifier.split("?")[0],
    );
    const relative = path.relative(featureDir, destination);
    if (
      relative === ".." ||
      relative.startsWith("../") ||
      path.isAbsolute(relative)
    )
      return null;
    target = relative.split(path.sep)[0];
  } else {
    return null;
  }
  return target && existsSync(path.join(featureDir, target)) ? target : null;
}

function findFeatureEdges() {
  const runtime = new Map();
  const spec = new Map();
  for (const feature of readdirSync(featureDir, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory(),
  )) {
    for (const file of codeFiles(path.join(featureDir, feature.name))) {
      const isSpec = /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file);
      for (const name of importSpecifiers(file)) {
        const target = featureTarget(file, name);
        if (!target || target === feature.name) continue;
        const edge = feature.name + ">" + target;
        const targetMap = isSpec ? spec : runtime;
        if (!targetMap.has(edge)) targetMap.set(edge, []);
        targetMap.get(edge).push(path.relative(root, file));
      }
    }
  }
  return { runtime, spec };
}

function getPackages() {
  return new Map(
    readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const dir = path.join(packagesDir, entry.name);
        return [
          entry.name,
          {
            dir,
            manifest: JSON.parse(
              readFileSync(path.join(dir, "package.json"), "utf8"),
            ),
          },
        ];
      }),
  );
}

function isExported(manifest, subpath) {
  return Object.keys(manifest.exports ?? {}).some(
    (key) =>
      key === subpath ||
      (key.includes("*") &&
        subpath.startsWith(key.split("*")[0]) &&
        subpath.endsWith(key.split("*")[1])),
  );
}

function sourceForExportTarget(dir, target) {
  if (target.includes("*") && !target.startsWith("./dist/"))
    return path.join(dir, path.dirname(target));
  if (!target.startsWith("./dist/")) return path.join(dir, target);
  const translated = target.replace(/^\.\/dist\//, "src/");
  if (translated.includes("*")) return path.join(dir, path.dirname(translated));
  const withoutSuffix = translated.replace(/\.d\.ts$|\.js$/, "");
  const candidates = [
    withoutSuffix + ".ts",
    withoutSuffix + ".tsx",
    withoutSuffix + ".mts",
    withoutSuffix + ".d.ts",
  ];
  return (
    candidates.map((candidate) => path.join(dir, candidate)).find(existsSync) ??
    path.join(dir, candidates[0])
  );
}

function packageViolations(packages) {
  const violations = [];
  for (const [name, { dir, manifest }] of packages) {
    const declared = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
    };
    for (const file of codeFiles(dir)) {
      for (const imp of importSpecifiers(file)) {
        if (imp.startsWith(".")) {
          const destination = path.resolve(path.dirname(file), imp);
          const relative = path.relative(dir, destination);
          if (
            relative === ".." ||
            relative.startsWith("../") ||
            path.isAbsolute(relative)
          ) {
            violations.push(
              path.relative(root, file) +
                ": import relative vượt package: " +
                imp,
            );
          }
          continue;
        }
        if (!imp.startsWith("@giaokhoa/")) continue;
        const parts = imp.split("/");
        const importedName = parts[1];
        const target = packages.get(importedName);
        if (!target) {
          violations.push(
            path.relative(root, file) +
              ": package workspace không tồn tại: " +
              imp,
          );
          continue;
        }
        if (name === importedName) continue;
        if (!Object.hasOwn(declared, "@giaokhoa/" + importedName)) {
          violations.push(
            path.relative(root, file) + ": dependency chưa khai báo: " + imp,
          );
        }
        const subpath =
          parts.length === 2 ? "." : "./" + parts.slice(2).join("/");
        if (!isExported(target.manifest, subpath)) {
          violations.push(
            path.relative(root, file) + ": import ngoài public exports: " + imp,
          );
        }
      }
    }
    for (const [key, value] of Object.entries(manifest.exports ?? {})) {
      for (const target of typeof value === "string"
        ? [value]
        : Object.values(value)) {
        const source = sourceForExportTarget(dir, target);
        if (
          !existsSync(source) ||
          (target.includes("*") && !statSync(source).isDirectory())
        ) {
          violations.push(
            "packages/" +
              name +
              ": exports " +
              key +
              " chưa có nguồn " +
              target,
          );
        }
      }
    }
  }

  // Ứng dụng cũng chỉ tiêu thụ API công khai của package đã khai dependency.
  for (const app of readdirSync(path.join(root, "apps"), {
    withFileTypes: true,
  }).filter((entry) => entry.isDirectory())) {
    const dir = path.join(root, "apps", app.name);
    const manifest = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    );
    const declared = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
    };
    for (const file of codeFiles(dir)) {
      for (const imp of importSpecifiers(file)) {
        if (imp.startsWith(".")) {
          const destination = path.resolve(path.dirname(file), imp);
          const relative = path.relative(dir, destination);
          if (
            relative === ".." ||
            relative.startsWith("../") ||
            path.isAbsolute(relative)
          ) {
            const edge =
              path.relative(root, file) +
              ">" +
              path.relative(root, destination);
            if (!frozenCrossAppTestImports.has(edge)) {
              violations.push(
                path.relative(root, file) +
                  ": import relative vượt app: " +
                  imp,
              );
            }
          }
          continue;
        }
        if (!imp.startsWith("@giaokhoa/")) continue;
        const parts = imp.split("/");
        const importedName = parts[1];
        const target = packages.get(importedName);
        if (!target) {
          violations.push(
            path.relative(root, file) +
              ": package workspace không tồn tại: " +
              imp,
          );
          continue;
        }
        if (!Object.hasOwn(declared, "@giaokhoa/" + importedName)) {
          violations.push(
            path.relative(root, file) + ": dependency chưa khai báo: " + imp,
          );
        }
        const subpath =
          parts.length === 2 ? "." : "./" + parts.slice(2).join("/");
        if (!isExported(target.manifest, subpath)) {
          violations.push(
            path.relative(root, file) + ": import ngoài public exports: " + imp,
          );
        }
      }
    }
  }
  return violations;
}

function packageCycles(packages) {
  const edges = new Map(
    [...packages].map(([name, { manifest }]) => [
      name,
      Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.peerDependencies,
      })
        .filter(
          (dep) =>
            dep.startsWith("@giaokhoa/") &&
            packages.has(dep.slice("@giaokhoa/".length)),
        )
        .map((dep) => dep.slice("@giaokhoa/".length)),
    ]),
  );
  const errors = [];
  const visited = new Set();
  const visiting = new Set();
  function visit(node, trail) {
    if (visiting.has(node)) {
      errors.push([...trail, node].join(" -> "));
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    for (const next of edges.get(node) ?? []) visit(next, [...trail, node]);
    visiting.delete(node);
    visited.add(node);
  }
  for (const node of edges.keys()) visit(node, []);
  return errors;
}

test("parser nhận import tĩnh, type, re-export và dynamic import nhưng không đọc comment", () => {
  const source = [
    "import type { Example } from '#features/alpha/types/example';",
    "export { Example } from '#features/beta/queries/example';",
    "const load = () => import('#features/gamma/routes/example');",
    "const value = require('#features/delta/api/example');",
    "// import '#features/ignored/example'",
  ].join("\n");
  assert.deepEqual(importSpecifiers("sample.ts", source), [
    "#features/alpha/types/example",
    "#features/beta/queries/example",
    "#features/gamma/routes/example",
    "#features/delta/api/example",
  ]);
});

test("feature target nhận cả đường alias và đường relative", () => {
  const source = path.join(featureDir, "questions/components/questions.tsx");
  assert.equal(
    featureTarget(source, "#features/matrices/types/matrix"),
    "matrices",
  );
  assert.equal(
    featureTarget(source, "../../matrices/types/matrix"),
    "matrices",
  );
  assert.equal(featureTarget(source, "../queries/questions"), "questions");
  assert.equal(
    featureTarget(source, "../../../../../packages/db/src/index"),
    null,
  );
});

function unexpectedFeatureEdges({ runtime, spec }) {
  const violations = [];
  for (const [edge, sources] of runtime) {
    if (!frozenRuntimeEdges.has(edge))
      violations.push("runtime " + edge + ": " + sources.join(", "));
  }
  for (const [edge, sources] of spec) {
    if (!frozenRuntimeEdges.has(edge) && !frozenSpecOnlyEdges.has(edge)) {
      violations.push("spec " + edge + ": " + sources.join(", "));
    }
  }
  return violations;
}

test("một import ngang mới bị chặn kể cả khi viết qua alias và relative", () => {
  const file = path.join(featureDir, "questions/components/questions.tsx");
  const code =
    "import '#features/notifications/api/notifications';\nimport '../../notifications/queries/notifications';";
  const targets = importSpecifiers(file, code).map((specifier) =>
    featureTarget(file, specifier),
  );
  assert.deepEqual(targets, ["notifications", "notifications"]);
  const edge = "questions>" + targets[0];
  const violations = unexpectedFeatureEdges({
    runtime: new Map([[edge, [path.relative(root, file)]]]),
    spec: new Map(),
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /questions>notifications/);
});

test("web không phát sinh cặp import ngang ngoài baseline đóng băng", () => {
  assert.deepEqual(
    unexpectedFeatureEdges(findFeatureEdges()),
    [],
    "Không tự mở rộng baseline; sửa đường import hoặc cập nhật quyết định bằng issue",
  );
});

test("các package chỉ import public entrypoint đã khai báo và không vượt package", () => {
  assert.deepEqual(packageViolations(getPackages()), []);
});

test("đồ thị phụ thuộc các package không có chu trình", () => {
  assert.deepEqual(packageCycles(getPackages()), []);
});
