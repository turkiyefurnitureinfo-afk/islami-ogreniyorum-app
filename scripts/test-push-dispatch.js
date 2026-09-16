// Quick behavioral test for the server's push-dispatch helpers.
// Run: node scripts/test-push-dispatch.js   (plain Node — server modules are CJS)
//
// Covers the dispatch machinery extracted from server/index.js:
//   sanitizeText | channelForTrigger | buildPushMessage | sendPushChunks
const {
  DEFAULT_CHUNK_SIZE,
  sanitizeText,
  channelForTrigger,
  buildPushMessage,
  sendPushChunks,
  collectReceiptIds,
  fetchPushReceipts,
} = require('../server/push-dispatch.js');

let pass = 0, fail = 0;
const T = (name, cond) => {
  if (cond) { pass++; console.log('  ok - ' + name); }
  else { fail++; console.log('  FAIL - ' + name); }
};

// --- sanitizeText ---
T('sanitizeText trims whitespace', sanitizeText('  hello  ') === 'hello');
T('sanitizeText strips control chars', sanitizeText('a\u0000b\u0007c\nd') === 'abc\nd');
T('sanitizeText caps length', sanitizeText('abcdef', 3) === 'abc');
T('sanitizeText null → empty', sanitizeText(null) === '');
T('sanitizeText undefined → empty', sanitizeText(undefined) === '');

// --- channelForTrigger ---
const COMMUNITY_CHANNEL_ID = 'community-activity';
T('channelForTrigger new_post → community',
  channelForTrigger('new_post', COMMUNITY_CHANNEL_ID) === COMMUNITY_CHANNEL_ID);
T('channelForTrigger new_comment → community',
  channelForTrigger('new_comment', COMMUNITY_CHANNEL_ID) === COMMUNITY_CHANNEL_ID);
T('channelForTrigger new_answer → community',
  channelForTrigger('new_answer', COMMUNITY_CHANNEL_ID) === COMMUNITY_CHANNEL_ID);
T('channelForTrigger new_question → community', 
  channelForTrigger('new_question', COMMUNITY_CHANNEL_ID) === COMMUNITY_CHANNEL_ID);
T('channelForTrigger unknown → default (null)',
  channelForTrigger('upcoming_event', COMMUNITY_CHANNEL_ID) === null);

// --- buildPushMessage ---
const m1 = buildPushMessage({ token: 'ExpoPushToken[abc]', title: 'Yeni İçerik!', body: 'Bir mesaj', data: { type: 'new_post' } });
T('buildPushMessage valid token → message', !!m1 && m1.to === 'ExpoPushToken[abc]');
T('buildPushMessage default sound', m1.sound === 'default');
T('buildPushMessage title fallback', buildPushMessage({ token: 't1', title: '   ' }).title === 'Notification');
T('buildPushMessage body empty', buildPushMessage({ token: 't1', body: null }).body === '');
T('buildPushMessage empty token → null', buildPushMessage({ token: '' }) === null);
T('buildPushMessage non-string token → null', buildPushMessage({ token: 42 }) === null);
T('buildPushMessage tokenValid false → null',
  buildPushMessage({ token: 'bad', tokenValid: () => false }) === null);
T('buildPushMessage tokenValid true → message',
  !!buildPushMessage({ token: 'good', tokenValid: () => true }));
T('buildPushMessage attaches channelId',
  buildPushMessage({ token: 't1', channelId: COMMUNITY_CHANNEL_ID }).channelId === COMMUNITY_CHANNEL_ID);
T('buildPushMessage non-object data → {}',
  buildPushMessage({ token: 't1', data: 'nope' }).data === '{}' || JSON.stringify(buildPushMessage({ token: 't1', data: 'nope' }).data) === '{}');
T('buildPushMessage strips control chars from title',
  buildPushMessage({ token: 't1', title: 'a\u0007b' }).title === 'ab');

// --- sendPushChunks (fake Expo client) ---
function makeFakeExpo({ failCallIndexes = new Set(), onSend } = {}) {
  const sentCalls = [];
  const send = async (chunk) => {
    sentCalls.push(chunk);
    if (onSend) onSend(chunk);
    const callIndex = sentCalls.length - 1;
    if (failCallIndexes.has(callIndex)) throw new Error('network down');
    return chunk.map(() => ({ status: 'ok' }));
  };
  return { client: { sendPushNotificationsAsync: send }, sentCalls };
}

async function main() {
  // Chunk size: 250 messages → 3 calls (100/100/50).
  const fakeA = makeFakeExpo();
const mAny = (n) => Array.from({ length: n }, (_, i) => ({ to: 't' + i }));
const resA = await sendPushChunks(fakeA.client, mAny(250));
T('sendPushChunks sent == 250', resA.sent === 250);
T('sendPushChunks ok', resA.ok === true);
T('sendPushChunks respects DEFAULT_CHUNK_SIZE (3 calls)',
  fakeA.sentCalls.length === 3 &&
  fakeA.sentCalls[0].length === DEFAULT_CHUNK_SIZE &&
  fakeA.sentCalls[2].length === 50);

// Ticket errors are counted, not throwing.
const fakeB = makeFakeExpo();
fakeB.client.sendPushNotificationsAsync = async (chunk) =>
  chunk.map((m) => (m.to === 't0' ? { status: 'error', message: 'Invalid token' } : { status: 'ok' }));
let ticketFails = 0;
const ticketErrors = [];
const resB = await sendPushChunks(fakeB.client, mAny(10), {
  onTicketError: (t) => { ticketFails++; ticketErrors.push(t.message); },
});
T('sendPushChunks counts ticket errors', resB.sent === 9 && resB.failed === 1 && ticketFails === 1);
T('sendPushChunks forwards ticket detail', ticketErrors[0] === 'Invalid token');

// One chunk's network failure must not abort later chunks.
const fakeC = makeFakeExpo({ failCallIndexes: new Set([0]) });
const resC = await sendPushChunks(fakeC.client, mAny(150));
T('sendPushChunks survives chunk failure', resC.sent === 50 && resC.failed === 100);
T('sendPushChunks later chunks still sent', fakeC.sentCalls.length === 2);

// No expo client → graceful reason.
const resD = await sendPushChunks(null, mAny(5));
T('sendPushChunks no client → no-expo-client', resD.reason === 'no-expo-client' && resD.sent === 0);

// Non-array messages → treated as empty.
const resE = await sendPushChunks({ sendPushNotificationsAsync: async () => [] }, null);
T('sendPushChunks null messages → empty ok', resE.sent === 0 && resE.ok === false);

// --- tickets are propagated so receipts can be checked later ---
const fakeF = makeFakeExpo();
const resF = await sendPushChunks(fakeF.client, mAny(3));
T('sendPushChunks returns tickets array', Array.isArray(resF.tickets) && resF.tickets.length === 3);
T('sendPushChunks maps each ticket back to its token',
  resF.tickets[0].token === 't0' && resF.tickets[2].token === 't2');

// --- collectReceiptIds ---
T('collectReceiptIds keeps only accepted tickets',
  collectReceiptIds([
    { status: 'ok', id: 'r1' },
    { status: 'error', message: 'nope' },
    { status: 'ok' }, // no id → not pollable
  ]).join(',') === 'r1');
T('collectReceiptIds null-safe', collectReceiptIds(null).length === 0);

// --- fetchPushReceipts: the ONLY place Expo reports real delivery failures ---
const receiptErrors = [];
const fakeG = {
  async sendPushNotificationsAsync(chunk) {
    return chunk.map((_m, i) => ({ status: 'ok', id: 'rc' + i }));
  },
  async getPushNotificationReceiptsAsync(ids) {
    const out = {};
    for (const id of ids) {
      out[id] = id === 'rc1'
        ? { status: 'error', message: 'Device not registered', details: { error: 'DeviceNotRegistered' } }
        : { status: 'ok' };
    }
    return out;
  },
};
const sentG = await sendPushChunks(fakeG, mAny(3));
const recG = await fetchPushReceipts(fakeG, sentG.tickets, {
  delayMs: 0,
  onReceiptError: (r) => receiptErrors.push(r),
});
T('fetchPushReceipts checked receipts', recG.checked === true);
T('fetchPushReceipts surfaces DeviceNotRegistered',
  recG.errors.length === 1 && recG.errors[0].details.error === 'DeviceNotRegistered');
T('fetchPushReceipts maps the failing receipt back to its token',
  recG.errors[0].token === 't1');
T('fetchPushReceipts invokes onReceiptError callback', receiptErrors.length === 1);

// No accepted tickets → nothing to poll, no API call needed.
const recH = await fetchPushReceipts(
  { async getPushNotificationReceiptsAsync() { throw new Error('should not be called'); } },
  [{ status: 'error', message: 'rejected' }],
  { delayMs: 0 }
);
T('fetchPushReceipts skips when no ticket was accepted',
  recH.checked === false && recH.errors.length === 0);

// Missing client method → graceful, never throws.
const recI = await fetchPushReceipts(null, [{ status: 'ok', id: 'x' }], { delayMs: 0 });
T('fetchPushReceipts no client → not checked', recI.checked === false);

// A throwing receipts endpoint must degrade, not crash the dispatcher.
const recJ = await fetchPushReceipts(
  { async getPushNotificationReceiptsAsync() { throw new Error('network down'); } },
  [{ status: 'ok', id: 'x', token: 't0' }],
  { delayMs: 0 }
);
T('fetchPushReceipts survives a throwing endpoint',
  recJ.checked === true && recJ.errors.length === 1 && /network down/.test(recJ.errors[0].message));
}

main().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((error) => {
  console.error('[test-push-dispatch] harness crashed:', error);
  process.exit(1);
});