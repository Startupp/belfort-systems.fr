import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pageDe, pousser } from '../src/desk/pousser.ts';
import { DEFAULT_DESK_CONFIG } from '../src/desk/types.ts';

test('pousser : page du carnet en direct (gain latent au dernier cours) envoyée au Worker', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'carnet-'));
  writeFileSync(join(dir, 'trades.jsonl'), '');
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ version: 1, startEquity: 500, cash: 500, open: [] }));
  const seen: string[] = [];
  const html = await pageDe({ id: 'desk', dir, cfg: DEFAULT_DESK_CONFIG }, async (s) => (seen.push(s), 100));
  assert.match(html, /Carnet de trades/);
  let sent: { url: string; init?: RequestInit } | undefined;
  const code = await pousser('https://x.dev/desk', { id: 'crypto', dir, cfg: DEFAULT_DESK_CONFIG }, html, (async (url: string, init?: RequestInit) => {
    sent = { url, init };
    return new Response(null, { status: 204 });
  }) as typeof fetch);
  assert.equal(code, 204);
  assert.equal(sent?.url, 'https://x.dev/desk?portefeuille=crypto');
  assert.equal(sent?.init?.method, 'POST');
  assert.equal(sent?.init?.body, html);
  assert.ok(!JSON.stringify(sent?.init?.headers ?? {}).toLowerCase().includes('authorization'), 'le jeton est ajouté par le proxy, pas par le script');
});
