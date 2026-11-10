import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NY, PARIS, zonedToUtc } from '../src/arena/strategies.ts';
import { localTime } from '../src/desk/market.ts';
import type { Bar } from '../src/desk/types.ts';
import { CHOICES, SESSIONS, START_MS } from '../worker/config.ts';
import { decodeBars, dueAt, encodeBars, feedOf, roster } from '../worker/index.ts';
import worker from '../worker/index.ts';
import { pageHtml } from '../worker/dash.ts';
import { MemoryD1 } from '../worker/memory-d1.ts';

test('worker : réglages figés identiques à ceux du suivi de l’arène (covid.json, sinon comptes.json)', () => {
  const covid = JSON.parse(readFileSync('arene/covid.json', 'utf8')) as { accounts: Array<{ id: string; final?: { index: number } }> };
  const comptes = JSON.parse(readFileSync('arene/comptes.json', 'utf8')) as { results: Array<{ id: string; chosen: number }> };
  for (const l of roster()) {
    const id = l.account.id;
    const expected = covid.accounts.find((a) => a.id === id)?.final?.index ?? comptes.results.find((r) => r.id === id)?.chosen ?? 0;
    assert.equal(CHOICES[id], expected, id);
  }
  assert.equal(START_MS, zonedToUtc('2026-11-12', 0, PARIS));
});

test('worker : plages des barres de 5 min = variantes choisies (or : NY 9 h 30 – 13 h ; EUR/USD : Londres)', () => {
  const live = roster();
  const fiveMin = new Set(live.flatMap((l) => [...l.feeds.values()].filter((f) => f.tf === '5m').map((f) => f.sym)));
  assert.deepEqual([...fiveMin].sort(), Object.keys(SESSIONS).sort());
  assert.equal(live.find((l) => l.account.id === 'a4-forex')?.variant.label, 'Londres');
  assert.match(live.find((l) => l.account.id === 'a3-or')?.variant.label ?? '', /objectif 2 R/);
});

test('worker : créneaux (UTC) des lectures', () => {
  const qqq = feedOf('y5m', 'QQQ');
  const eur = feedOf('y5m', 'EURUSD=X');
  const gold = feedOf('gold5m', 'GC=F');
  const perp = feedOf('kfut1h', 'PF_XBTUSD');
  const btc1h = feedOf('crypto1h', 'BTC-USD');
  const spyD = feedOf('daily', 'SPY');
  // Jeudi 12 novembre 2026, 14 h 36 UTC = 9 h 36 à New York : la 1re barre (9 h 30 – 9 h 35) est lisible.
  const t = Date.parse('2026-11-12T14:36:00Z');
  assert.equal(localTime(t, NY).minutes, 576);
  assert.ok(dueAt(qqq, t) && dueAt(gold, t) && dueAt(eur, t));
  assert.ok(!dueAt(qqq, t + 60_000), 'une seule minute sur cinq');
  assert.ok(!dueAt(qqq, Date.parse('2026-11-12T14:31:00Z')), 'avant la fin de la 1re barre');
  assert.ok(!dueAt(gold, Date.parse('2026-11-12T18:21:00Z')), 'or : après 13 h 15 à New York');
  assert.ok(!dueAt(eur, Date.parse('2026-11-12T17:21:00Z')), 'EUR/USD : après 17 h 15 à Londres');
  assert.ok(!dueAt(qqq, Date.parse('2026-11-14T15:01:00Z')), 'samedi');
  assert.ok(dueAt(perp, Date.parse('2026-11-12T10:02:00Z')) && !dueAt(perp, Date.parse('2026-11-12T10:03:00Z')));
  assert.ok(dueAt(btc1h, Date.parse('2026-11-12T10:03:00Z')));
  const dailyMinutes = [41, 42, 43, 44, 45].filter((m) => dueAt(spyD, Date.parse(`2026-11-12T22:${m}:00Z`)));
  assert.equal(dailyMinutes.length, 1, 'journalier : une minute entre 22 h 41 et 22 h 45');
});

test('worker : barres stockées en entiers, relues à l’identique (cours au pas du marché)', () => {
  const f = feedOf('y5m', 'EURUSD=X');
  const bars: Bar[] = [
    { t: Date.parse('2026-11-12T08:00:00Z'), o: 1.15607, h: 1.15702, l: 1.15511, c: 1.1563, v: 0 },
    { t: Date.parse('2026-11-12T08:05:00Z'), o: 1.1563, h: 1.15699, l: 1.156, c: 1.15655, v: 0 },
    { t: Date.parse('2026-11-12T09:00:00Z'), o: 1.15655, h: 1.1571, l: 1.1561, c: 1.157, v: 0 },
  ];
  assert.deepEqual(decodeBars(encodeBars(bars, f)), bars);
  // Les cours Yahoo arrivent en flottants 32 bits (676,1199951171875 pour 676,12) : ramenés au centime.
  const spy = feedOf('spy5m', 'SPY');
  const back = decodeBars(encodeBars([{ t: 0, o: 676.1199951171875, h: 676.5, l: 675.9000244140625, c: 676.3, v: 123456 }], spy));
  assert.deepEqual(back[0], { t: 0, o: 676.12, h: 676.5, l: 675.9, c: 676.3, v: 123456 });
});

test('worker : page protégée par le lien secret, JSON inclus sans pouvoir fermer la balise script', async () => {
  const html = pageHtml(JSON.stringify({ notes: ['</script><b>x</b>'] }));
  assert.ok(!html.includes('</script><b>'));
  assert.ok(html.includes('\\u003c/script>'));
  const env = { DB: new MemoryD1(), TOKEN: 'jeton-de-test-assez-long' };
  assert.equal((await worker.fetch(new Request('https://x.dev/'), env)).status, 404);
  assert.equal((await worker.fetch(new Request('https://x.dev/mauvais/'), env)).status, 404);
  assert.equal((await worker.fetch(new Request('https://x.dev/jeton-de-test-assez-long'), env)).status, 301);
  const page = await worker.fetch(new Request('https://x.dev/jeton-de-test-assez-long/'), env);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  const api = await (await worker.fetch(new Request('https://x.dev/jeton-de-test-assez-long/api'), env)).json();
  assert.equal((api as { mode: string }).mode, 'papier');
});
