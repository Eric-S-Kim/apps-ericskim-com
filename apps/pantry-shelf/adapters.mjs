// Pantry Shelf — pure adapter logic (C+ architecture).
// Shared verbatim by the browser PWA (public/app.mjs) and the Node tests (test/).
// NO side effects, NO network — just data in, data out. This is the part the
// reviewers said must be deterministic and tested.
//
// VENDOR TELEPORT MAP
//   amazon  -> https://<host>/dp/<ASIN>         Buy-Now page. NOT a pre-filled cart.
//                                               (Amazon add-to-cart URLs hit a confirm/login
//                                                wall in 2026 — honest teleport is the dp page.)
//   shopify -> https://<domain>/cart/<vId>:<q>  REAL pre-filled cart permalink. Needs the
//                                               CURRENT variantId (re-resolve before use).
//   other   -> productUrl                       Just open the page.
//
// HONESTY RULES (enforced by test/adapters.test.mjs):
//   1. A snapshot is NEVER a live "in stock" claim — every field carries an `asOf` date.
//   2. variant-lock: an offer whose label trips `mustNotMatch` is rejected (untinted != tinted).
//   3. No teleport URL is offered for a sold_out / unresolved vendor.

export function buildCartUrl(vendor) {
  if (!vendor) return null;
  switch (vendor.platform) {
    case 'amazon': {
      if (!vendor.asin) return null;
      const host = vendor.market === 'CA' ? 'www.amazon.ca' : 'www.amazon.com';
      return `https://${host}/dp/${vendor.asin}`;
    }
    case 'shopify': {
      // Requires the CURRENT variantId. Null variantId => unresolved => no teleport.
      if (!vendor.domain || !vendor.variantId) return null;
      const qty = vendor.qty || 1;
      return `https://${vendor.domain}/cart/${vendor.variantId}:${qty}`;
    }
    default:
      return vendor.productUrl || null;
  }
}

// variant-lock guard. True only if a live offer label matches the locked variant.
// This is the guard against the exact failure that started the project: buying the
// Tinted (or wrong size / wrong SPF) when you wanted Untinted 1.7oz.
export function offerMatchesVariant(variant, offerLabel) {
  if (!variant || !offerLabel) return false;
  const label = String(offerLabel).toLowerCase();
  // Word-boundary match, NOT substring: "tinted" must not match inside "untinted".
  const hasToken = (tok) => {
    const esc = String(tok).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${esc}\\b`).test(label);
  };
  for (const bad of variant.mustNotMatch || []) {
    if (hasToken(bad)) return false;
  }
  for (const need of variant.mustMatch || []) {
    if (!hasToken(need)) return false;
  }
  return true;
}

// Pick the vendor to feature: first in-stock snapshot by priority, else the first vendor.
export function pickVendor(item) {
  const vendors = item.vendors || [];
  return vendors.find(v => v.status === 'in_stock_snapshot') || vendors[0] || null;
}

// Build the HONEST confidence card for an item + a chosen vendor snapshot.
// teleportUrl is null unless the snapshot says in-stock AND the vendor is resolved.
export function buildConfidenceCard(item, vendor) {
  const snap = (vendor && vendor.snapshot) || null;
  const status = (vendor && vendor.status) || 'unknown';
  // Offer the reorder teleport for any buyable status; only sold-out / unresolved get none.
  const teleportUrl = (status === 'sold_out' || status === 'unresolved') ? null : buildCartUrl(vendor);
  return {
    title: item.name,
    variantLocked: item.variant.label,          // exact variant, always shown
    why: item.why,
    vendorName: vendor ? vendor.name : null,
    // price / seller / eta are SNAPSHOTS — each carries asOf, none is presented as live truth.
    priceText: snap ? `${snap.currency} ${Number(snap.landed).toFixed(2)} landed (as of ${snap.asOf})` : null,
    priceShort: snap ? `${snap.currency} ${Number(snap.landed).toFixed(2)}` : null,   // Simple view: price, no asOf
    sellerText: snap && snap.seller ? `${snap.seller} (as of ${snap.asOf})` : null,
    statusLabel: snapshotStatusLabel(status, snap),
    statusShort: snapshotStatusShort(status),                                          // Simple view: terse chip word
    teleportUrl,
    teleportLabel: teleportLabel(vendor),
    verifyPrompt: buildVerifyPrompt(item, vendor),  // hand-off to the engine (Claude)
  };
}

export function snapshotStatusLabel(status, snap) {
  const asOf = snap ? ` (as of ${snap.asOf})` : '';
  switch (status) {
    case 'in_stock_snapshot': return `In stock${asOf} — verify for live truth`;
    case 'snapshot':          return `Last bought${asOf} — tap to reorder`;
    case 'sold_out':          return `Sold out${asOf}`;
    case 'unresolved':        return `Not yet verified — tap Verify`;
    default:                  return `Unknown — tap Verify`;
  }
}

// Terse, glanceable status word for the Simple-view chip (no asOf, no instruction tail).
export function snapshotStatusShort(status) {
  switch (status) {
    case 'in_stock_snapshot': return 'In stock';
    case 'snapshot':          return 'Last bought';
    case 'sold_out':          return 'Sold out';
    case 'unresolved':        return 'Unverified';
    default:                  return 'Unverified';
  }
}

export function teleportLabel(vendor) {
  if (!vendor) return null;
  if (vendor.platform === 'amazon') return 'Open on Amazon (Buy Now)';
  if (vendor.platform === 'shopify') return 'Open pre-filled cart';
  return 'Open product page';
}

// The bridge to the engine: a ready-to-paste Claude prompt. The PWA cannot summon
// Claude itself, so "Verify" / "Hunt" copy this for you to paste into a session.
export function buildVerifyPrompt(item, vendor) {
  const where = vendor ? (vendor.productUrl || vendor.name) : 'my saved vendors';
  const not = (item.variant.mustNotMatch || []).join(' / ');
  return `Verify live stock + landed price for "${item.name}" (${item.variant.label}` +
    (not ? `, must NOT be ${not}` : '') +
    `), shipping to Vancouver BC, at ${where}. If it's sold out there, run the reputable-source ` +
    `hunt across stores that ship to Canada and report the cheapest in-stock authorized option.`;
}

// Map the older fine-grained `category` values onto the 4 display groups, so a shelf
// saved BEFORE the `group` field existed still collapses into the same 4 clean sections
// (instead of one section per raw category). Explicit `group` always wins over this.
const CATEGORY_TO_GROUP = {
  'Facial sunscreen': 'Bath & Body',
  'Cleanser': 'Bath & Body',
  'Grooming': 'Bath & Body',
  'Supplement': 'Wellness',
  'Sparkling water': 'Kitchen',
  'Home / cleaning': 'Home & Cleaning',
};

// The single source of truth for which group an item belongs to:
// explicit `group` > mapped `category` > raw `category` > 'Other'.
export function itemGroup(it) {
  if (!it) return 'Other';
  if (it.group) return it.group;
  if (it.category && CATEGORY_TO_GROUP[it.category]) return CATEGORY_TO_GROUP[it.category];
  return it.category || 'Other';
}

// Group items into collapsible UI sections. FIRST-APPEARANCE order: the order a
// group first shows up in the items array controls its section order (so reordering
// items reorders sections). Within a group, items keep their array order.
export function groupItems(items) {
  const order = [];
  const buckets = new Map();
  const emojis = new Map(); // a group's icon may come from the DATA (keeps niche labels out of public code)
  for (const it of (items || [])) {
    const g = itemGroup(it);
    if (!buckets.has(g)) { buckets.set(g, []); order.push(g); }
    buckets.get(g).push(it);
    if (it && it.groupEmoji && !emojis.has(g)) emojis.set(g, it.groupEmoji);
  }
  return order.map((g) => ({ group: g, emoji: emojis.get(g) || groupEmoji(g), items: buckets.get(g) }));
}

export function groupEmoji(group) {
  return ({
    'Bath & Body': '🛁',
    'Wellness': '💊',
    'Kitchen': '🍴',
    'Home & Cleaning': '🧹',
  })[group] || '📦';
}
