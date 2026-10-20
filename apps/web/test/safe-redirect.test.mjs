import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeRedirectPath } from '../app/lib/http/redirect.ts';

void test('keeps same-origin paths and query strings', () => {
  assert.equal(
    safeRedirectPath('/questions/new?tab=edit#section'),
    '/questions/new?tab=edit#section',
  );
  assert.equal(safeRedirectPath('/onboarding'), '/onboarding');
});

void test('rejects external, protocol-relative, and backslash redirects', () => {
  for (const value of [
    null,
    '',
    'https://evil.example/',
    '//evil.example/',
    '/\\evil.example/',
    '/foo\\bar',
    'javascript:alert(1)',
  ]) {
    assert.equal(safeRedirectPath(value), '/');
    assert.equal(safeRedirectPath(value, '/questions/new'), '/questions/new');
  }
});

void test('never resolves encoded or control-character paths to an external origin', () => {
  for (const value of ['/%2F%2Fevil.example', '/%5Cevil.example', '/\n/evil.example']) {
    const path = safeRedirectPath(value);
    assert.equal(new URL(path, 'https://app.example').origin, 'https://app.example');
  }
});
