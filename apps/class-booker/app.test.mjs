import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeDataPayload, isClassBookerData, safeHttpsUrl } from './app.mjs';

const valid = {
  version: 1,
  classes: [{
    id: 'example',
    chip: 'M',
    tag: 'Movement',
    venue: 'Example Studio',
    when: 'Check the schedule',
    action: 'Open booking',
    url: 'https://example.com/book',
  }],
};

test('accepts a valid private class payload', () => {
  assert.equal(isClassBookerData(valid), true);
});

test('rejects unsafe URLs and duplicate ids', () => {
  assert.equal(isClassBookerData({ ...valid, classes: [{ ...valid.classes[0], url: 'javascript:alert(1)' }] }), false);
  assert.equal(isClassBookerData({ ...valid, classes: [valid.classes[0], valid.classes[0]] }), false);
  assert.equal(safeHttpsUrl('http://example.com'), null);
});

test('rejects empty and oversized payloads', () => {
  assert.equal(isClassBookerData({ version: 1, classes: [] }), false);
  assert.equal(isClassBookerData({ version: 1, classes: Array.from({ length: 26 }, (_, index) => ({ ...valid.classes[0], id: String(index) })) }), false);
});

test('decodes base64url setup data', () => {
  const encoded = Buffer.from(JSON.stringify(valid)).toString('base64url');
  assert.deepEqual(decodeDataPayload(encoded), valid);
});
