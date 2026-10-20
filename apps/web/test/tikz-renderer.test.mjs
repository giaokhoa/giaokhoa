import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_TIKZ_SOURCE_LENGTH } from '@giaokhoa/shared/files';
import { renderTikz } from '../app/lib/tikz-renderer.ts';

void test('rejects oversized TikZ source before creating a browser worker', async () => {
  await assert.rejects(
    renderTikz('x'.repeat(MAX_TIKZ_SOURCE_LENGTH + 1)),
    /Mã TikZ không được vượt quá/,
  );
});
