import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function commentLines(source) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    source,
  );
  const lines = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      lines.push(source.slice(0, scanner.getTokenPos()).split('\n').length);
    }
  }
  return lines;
}

if (process.argv.includes('--self-test')) {
  assert.deepEqual(commentLines('{"url":"https://site.test//path"}'), []);
  assert.deepEqual(commentLines('{"foo":1, // note\n"bar":2}'), [1]);
  assert.deepEqual(commentLines('{"foo":/* note */1}'), [1]);
  assert.deepEqual(commentLines('{"foo":1}'), []);
} else {
  const files = execFileSync('git', ['ls-files', '-z', '--', '*tsconfig*.json'])
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const violations = files.flatMap((file) =>
    commentLines(readFileSync(file, 'utf8')).map((line) => `${file}:${line}`),
  );
  if (violations.length > 0) {
    console.error('TypeScript configuration files must not contain comments:', violations.join(', '));
    process.exitCode = 1;
  } else {
    console.log(`Checked ${files.length} tsconfig files: no comments.`);
  }
}
