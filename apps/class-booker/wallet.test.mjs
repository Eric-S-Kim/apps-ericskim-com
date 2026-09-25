import test from 'node:test';
import assert from 'node:assert/strict';
import { validWallet, walletCards, ownership } from './wallet.mjs';

const pdf = { kind: 'pdf', name: 'Ticket.pdf', data: btoa('%PDF-1.4 original fixture') };
const source = (owner, order, ids = ['ticket-a']) => ({ sourceId: order, orderId: order,
  artifacts: [pdf], quantity: ids.length, admission: 'ticket', lifecycle: 'active',
  wallet: { orderKey: order, ownerLabel: owner, ownerBasis: 'order',
    admissions: ids.map((id, i) => ({ id, artifactIndex: 0, page: i + 1, holder: null })) } });
const booking = records => ({ records, artifacts: [], ready: true });

test('separate purchases keep names, shared orders keep distinct original pages in order', () => {
  const a = source('Alex', 'one', ['z', 'a']), b = source('Blair', 'two', ['b']);
  const cards = walletCards(booking([a, b]));
  assert.deepEqual(cards.map(c => [c.group.source.wallet.ownerLabel, c.ticket.id, c.page]), [['Alex','z',1],['Alex','a',2],['Blair','b',1]]);
  assert.equal(cards[0].groupCount, 2); assert.equal(cards[2].groupCount, 1);
  assert.equal(cards[0].ticket.holder, null);
});

test('identical delivery dedupes; conflicting code or reissued set becomes original-only', () => {
  const a = source('Alex', 'one'); const again = structuredClone(a); again.sourceId = 'forward';
  assert.equal(walletCards(booking([a, again])).length, 1);
  again.artifacts[0].data += 'changed';
  let cards = walletCards(booking([a, again]));
  assert.equal(cards[0].group.review, true); assert.equal(cards[0].artifact, undefined);
  const reissued = source('Alex', 'one', ['replacement']);
  cards = walletCards(booking([a, reissued])); assert.equal(cards[0].group.conflict, true);
  const otherOrder = source('Alex', 'other');
  assert.ok(walletCards(booking([a, otherOrder])).every(c => c.group.conflict));
});

test('one cancelled order does not remove another original, but never exposes its own inline code', () => {
  const a = source('Alex', 'one'), b = source('Blair', 'two', ['b']); a.lifecycle = 'cancelled';
  const cards = walletCards({ ...booking([a, b]), ready: false, status: 'review' });
  assert.equal(cards[0].artifact, undefined); assert.equal(cards[0].group.cancelled, true);
  assert.equal(cards[1].artifact, pdf); assert.equal(cards[1].group.cancelled, false);
});

test('source ownership never substitutes for an attendee; confirmation has no admission count', () => {
  const a = source('Alex', 'one'); a.wallet.ownerBasis = 'recipient';
  assert.equal(ownership(a), 'Sent to Alex'); assert.equal(a.wallet.admissions[0].holder, null);
  a.wallet.ownerBasis = 'forwarder'; assert.equal(ownership(a), 'Shared by Alex');
  a.artifacts = []; a.wallet.admissions = []; a.admission = 'confirmation';
  assert.ok(validWallet(a)); assert.equal(walletCards(booking([a]))[0].ticket, undefined);
});

test('contract rejects unknown ownership, duplicate/page references and invented quantities', () => {
  assert.ok(validWallet(source('Alex', 'one')));
  for (const mutate of [s => s.wallet.ownerBasis = 'attendee', s => s.wallet.ownerLabel = null,
    s => s.wallet.admissions[0].page = 0, s => s.wallet.admissions[0].page = 101,
    s => s.wallet.admissions[0].artifactIndex = 1, s => s.quantity = 2,
    s => s.admission = 'confirmation', s => s.wallet.admissions.push(s.wallet.admissions[0])]) {
    const s = source('Alex', 'one'); mutate(s); assert.equal(validWallet(s), false);
  }
});
