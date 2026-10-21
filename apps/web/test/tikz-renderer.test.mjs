import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasUnsafeSvgCss, MAX_TIKZ_SOURCE_LENGTH } from '@giaokhoa/shared/files';
import { renderTikz } from '../app/lib/tikz-renderer.ts';

void test('rejects oversized TikZ source before creating a browser worker', async () => {
  await assert.rejects(
    renderTikz('x'.repeat(MAX_TIKZ_SOURCE_LENGTH + 1)),
    /Mã TikZ không được vượt quá/,
  );
});

void test('CSS của TikZ chỉ được trỏ tới fragment cục bộ', () => {
  assert.equal(hasUnsafeSvgCss('fill:url(#gradient1)'), false);
  assert.equal(hasUnsafeSvgCss('stroke:blue'), false);
  assert.equal(hasUnsafeSvgCss('fill:url(https://attacker.example/x.svg#id)'), true);
  assert.equal(hasUnsafeSvgCss('@import url(https://attacker.example/x.css)'), true);
  assert.equal(hasUnsafeSvgCss('fill:u\\72l(https://attacker.example/x)'), true);
});
