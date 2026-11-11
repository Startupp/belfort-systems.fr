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
  assert.equal(START_MS, zonedToUtc('2026-11-11', 925, PARIS));
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

// ---------------------------------------------------------------------------- simulation minute par minute

import { runPortfolio } from '../src/arena/engine.ts';
import { FUNDING } from '../src/arena/strategies.ts';
import { cycle, resetMemory } from '../worker/index.ts';

/** Cours synthétiques déterministes (au pas du marché), pour chaque symbole et chaque instant. */
function price(sym: string, t: number): number {
  const base: Record<string, number> = { QQQ: 600, SPY: 680, 'GC=F': 4000, 'EURUSD=X': 1.15, 'BTC-USD': 90_000, 'ETH-USD': 3000, 'SOL-USD': 150, PF_XBTUSD: 90_000, PF_ETHUSD: 3000 };
  const b = base[sym] ?? 100;
  const x = t / 3_600_000;
  const p = b * (1 + 0.01 * Math.sin(x / 3) + 0.004 * Math.sin(x * 1.7 + sym.length) + 0.002 * Math.sin(x * 11 + sym.charCodeAt(0)));
  const tick = sym === 'EURUSD=X' ? 1e5 : sym === 'GC=F' || sym.startsWith('PF_') ? 10 : 100;
  return Math.round(p * tick) / tick;
}
function bar(sym: string, t: number, ms: number): { t: number; o: number; h: number; l: number; c: number; v: number } {
  const o = price(sym, t);
  const c = price(sym, t + ms - 1);
  const m1 = price(sym, t + ms / 3);
  const m2 = price(sym, t + (2 * ms) / 3);
  return { t, o, h: Math.max(o, c, m1, m2), l: Math.min(o, c, m1, m2), c, v: 1000 + (Math.floor(t / ms) % 7) * 100 };
}
const usSession = (t: number): boolean => {
  const l = localTime(t, NY);
  const wd = new Date(`${l.date}T12:00:00Z`).getUTCDay();
  return wd >= 1 && wd <= 5 && l.minutes >= 570 && l.minutes < 960;
};

/**
 * Faux réseau : Yahoo, Coinbase, Kraken, d'après l'horloge simulée (barre en cours et barre « fantôme » comprises).
 * `coinbaseDown` : Coinbase refuse tout (429), comme souvent depuis les adresses de Cloudflare.
 */
function fakeFetch(clock: () => number, coinbaseDown = false): typeof fetch {
  const json = (body: unknown): Response => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const now = clock();
    const M5 = 300_000;
    const H1 = 3_600_000;
    if (url.host === 'query1.finance.yahoo.com' && url.pathname.includes('/chart/')) {
      const sym = decodeURIComponent(url.pathname.split('/').pop() as string);
      const days = { '1d': 1, '5d': 5, '1mo': 30, '2y': 730 }[url.searchParams.get('range') ?? '1d'] ?? 1;
      const out: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }> = [];
      if (url.searchParams.get('interval') === '5m') {
        const etf = sym === 'SPY' || sym === 'QQQ';
        for (let t = Math.floor((now - days * 86_400_000) / M5) * M5; t <= now; t += M5) if (!etf || usSession(t)) out.push(bar(sym, t, Math.min(M5, now - t + 1)));
        if (out.length && (!etf || usSession(now))) out.push({ ...bar(sym, now, 1), t: now - (now % 1000) }); // barre « fantôme » à l'heure de la cotation
      } else {
        for (let d = Math.floor((now - days * 86_400_000) / 86_400_000); d * 86_400_000 <= now; d++) {
          const date = new Date(d * 86_400_000).toISOString().slice(0, 10);
          const wd = new Date(d * 86_400_000).getUTCDay();
          const open = zonedToUtc(date, 570, NY);
          if (wd === 0 || wd === 6 || open > now) continue;
          out.push(bar(sym, open, Math.min(390 * 60_000, now - open + 1)));
        }
      }
      return json({ chart: { result: [{ meta: { regularMarketTime: Math.floor(now / 1000) }, timestamp: out.map((b) => Math.floor(b.t / 1000)), indicators: { quote: [{ open: out.map((b) => b.o), high: out.map((b) => b.h), low: out.map((b) => b.l), close: out.map((b) => b.c), volume: out.map((b) => b.v) }] } }] } });
    }
    if (url.host === 'query1.finance.yahoo.com') {
      const syms = (url.searchParams.get('symbols') ?? '').split(',').map(decodeURIComponent);
      return json(Object.fromEntries(syms.map((s) => [s, { close: [price(s, now)] }])));
    }
    if (url.host === 'api.exchange.coinbase.com') {
      if (coinbaseDown) return new Response('trop de requêtes', { status: 429 });
      const sym = url.pathname.split('/')[2] as string;
      const g = Number(url.searchParams.get('granularity')) * 1000;
      const a = Date.parse(url.searchParams.get('start') as string);
      const b = Date.parse(url.searchParams.get('end') as string);
      const rows: number[][] = [];
      for (let t = Math.ceil(a / g) * g; t <= Math.min(b, now); t += g) {
        const x = bar(sym, t, Math.min(g, now - t + 1));
        rows.push([t / 1000, x.l, x.h, x.o, x.c, x.v]);
      }
      return json(rows.reverse());
    }
    if (url.host === 'futures.kraken.com' && url.pathname.includes('/charts/')) {
      const sym = url.pathname.split('/')[5] as string;
      const a = Number(url.searchParams.get('from')) * 1000;
      const b = Number(url.searchParams.get('to')) * 1000;
      const candles = [];
      for (let t = Math.ceil(a / H1) * H1; t <= Math.min(b, now); t += H1) {
        const x = bar(sym, t, Math.min(H1, now - t + 1));
        candles.push({ time: t, open: String(x.o), high: String(x.h), low: String(x.l), close: String(x.c), volume: String(x.v) });
      }
      return json({ candles });
    }
    if (url.host === 'futures.kraken.com') {
      const sym = url.pathname.split('/').pop() as string;
      return json({ ticker: { symbol: sym, markPrice: price(sym, now), relativeFundingRate: 1e-5 * (1 + Math.sin(now / 7_200_000)) } });
    }
    if (url.host === 'api.kraken.com' && url.pathname.endsWith('/OHLC')) {
      const pair = url.searchParams.get('pair') as string;
      const sym = { XBTUSD: 'BTC-USD', ETHUSD: 'ETH-USD', SOLUSD: 'SOL-USD' }[pair] as string;
      const g = Number(url.searchParams.get('interval')) * 60_000;
      const since = Number(url.searchParams.get('since')) * 1000;
      const rows: Array<[number, string, string, string, string, string, string, number]> = [];
      for (let t = Math.max(Math.ceil(since / g) * g, Math.floor(now / g) * g - 720 * g); t <= now; t += g) {
        const x = bar(sym, t, Math.min(g, now - t + 1));
        rows.push([t / 1000, String(x.o), String(x.h), String(x.l), String(x.c), String(x.c), String(x.v), 1]);
      }
      return json({ error: [], result: { [{ XBTUSD: 'XXBTZUSD', ETHUSD: 'XETHZUSD', SOLUSD: 'SOLUSD' }[pair] as string]: rows, last: now / 1000 } });
    }
    if (url.host === 'api.kraken.com') return json({ result: { XXBTZUSD: { c: [String(price('BTC-USD', now))] }, XETHZUSD: { c: [String(price('ETH-USD', now))] }, SOLUSD: { c: [String(price('SOL-USD', now))] } } });
    return new Response('inconnu', { status: 404 });
  }) as typeof fetch;
}

for (const coinbaseDown of [false, true]) {
test(`worker : passage chaque minute pendant 32 h = un seul rejeu des mêmes barres, pour les 12 comptes${coinbaseDown ? ' (Coinbase refuse tout : Kraken en secours)' : ''}`, async () => {
  const start = Date.parse('2026-11-11T23:00:00Z'); // jeudi 12 novembre, 0 h à Paris
  let clock = start - 2 * 3_600_000;
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch(() => clock, coinbaseDown);
  resetMemory();
  FUNDING.clear();
  const db = new MemoryD1();
  const env = { DB: db, TOKEN: 'essai', START_MS: String(start) };
  try {
    for (; clock <= start + 30 * 3_600_000; clock += 60_000) {
      // Le passage part quelques secondes après l'heure prévue ; la mémoire est parfois perdue (nouvelle instance).
      if (clock % (37 * 60_000) === 0) resetMemory();
      await cycle(env, { now: clock + 7_000, slot: clock });
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  const summary = JSON.parse(db.rows.get('summary')?.v as string) as { filling: number; accounts: Array<{ id: string; trades: number }> };
  assert.equal(summary.filling, 0, 'historique complet');
  // Rejeu unique : mêmes barres (relues en base), même financement, jusqu'à la dernière barre traitée par le Worker.
  for (const s of ['PF_XBTUSD', 'PF_ETHUSD']) FUNDING.set(s, new Map(JSON.parse(db.rows.get(`funding|${s}`)?.v as string) as Array<[number, number]>));
  let ranSomewhere = 0;
  for (const l of roster()) {
    const book = JSON.parse(db.rows.get(`book|${l.account.id}`)?.v ?? 'null') as { state?: { cash: number; lastT: number; positions: Array<{ symbol: string; qty: number }> }; tradeCount: number; startPrices?: Record<string, number>; startAt?: number } | null;
    if (!book?.state) continue;
    ranSomewhere++;
    // Comptes journaliers : même départ immédiat (barre au départ, au cours relevé, avec les barres finies à ce moment-là).
    const data = new Map(
      [...l.feeds].map(([s, f]) => {
        const bars = decodeBars(db.rows.get(`bars|${f.tf}|${f.sym}`)?.v as string);
        const px = book.startPrices?.[s];
        if (px === undefined) return [s, bars];
        const end = (b: { t: number }): number => b.t + (f.src === 'yahoo' ? 390 * 60_000 : 86_400_000);
        return [s, [...bars.filter((b) => b.t < start && end(b) <= (book.startAt as number)), { t: start, o: px, h: px, l: px, c: px, v: 0 }, ...bars.filter((b) => b.t > start)]];
      }),
    );
    const one = runPortfolio(l.variant.spec, data, start, book.state.lastT + 1);
    assert.ok(Math.abs(one.state.cash - book.state.cash) < 1e-6, `${l.account.id} : argent ${book.state.cash} ≠ ${one.state.cash}`);
    assert.deepEqual(book.state.positions.map((p) => [p.symbol, p.qty]), one.state.positions.map((p) => [p.symbol, p.qty]), l.account.id);
    assert.equal(book.tradeCount, one.trades.length, `${l.account.id} : trades`);
  }
  assert.ok(ranSomewhere >= 8, `comptes repris : ${ranSomewhere}`);
  assert.ok(summary.accounts.length === 12);
  if (coinbaseDown) assert.ok(['b2-crypto-tendance', 'b3-portage', 'c3-btc-eth-200j'].every((id) => db.rows.has(`book|${id}`)), 'comptes crypto repris malgré Coinbase');
  // Départ immédiat : les comptes journaliers sont partis dans les premières minutes, et l'achat-conservation est investi.
  for (const id of ['b2-crypto-tendance', 'b4-swing-etf', 'c1-sp500', 'c2-faber', 'c3-btc-eth-200j', 'c4-permanent']) {
    const b = JSON.parse(db.rows.get(`book|${id}`)?.v as string) as { startAt?: number };
    assert.ok((b.startAt as number) - start < 5 * 60_000, `${id} parti tout de suite`);
  }
  const c1 = JSON.parse(db.rows.get('book|c1-sp500')?.v as string) as { state: { positions: unknown[] } };
  assert.equal(c1.state.positions.length, 1, 'achat-conservation investi dès le départ');
});
}
