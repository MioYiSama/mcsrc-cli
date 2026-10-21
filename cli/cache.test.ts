import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { cacheStorage, configureJarCache } from './cache.ts';


test('client.jar cache verifies versions and preserves the last valid download on failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcsrc-cache-'));
  const url = 'https://example.invalid/client.jar';
  const firstSha1 = createHash('sha1').update('first version').digest('hex');
  const secondSha1 = createHash('sha1').update('second version').digest('hex');
  const cache = await cacheStorage.open('mcsrc-v1');
  try {
    configureJarCache(url, firstSha1, directory);
    assert.equal(await cache.match(url), undefined);
    await cache.put(url, new Response('first version'));
    assert.equal(await cache.match('https://example.invalid/client_mappings.txt'), undefined);
    assert.equal(await (await cache.match(url))?.text(), 'first version');

    configureJarCache(url, secondSha1, directory);
    assert.equal(await cache.match(url), undefined);
    await assert.rejects(cache.put(url, new Response('corrupted download')), /SHA-1 mismatch/);
    assert.equal(await readFile(join(directory, 'client.jar'), 'utf8'), 'first version');
    assert.deepEqual(await readdir(directory), ['client.jar']);

    await cache.put(url, new Response('second version'));
    assert.equal(await (await cache.match(url))?.text(), 'second version');
    const broken = new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new Error('connection lost')); },
    });
    await assert.rejects(cache.put(url, new Response(broken)), /connection lost/);
    assert.equal(await (await cache.match(url))?.text(), 'second version');
    assert.deepEqual(await readdir(directory), ['client.jar']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a derived cache hit cannot leave client.jar pointing at a different version', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcsrc-cache-'));
  const url = 'https://example.invalid/client.jar';
  const remapped = 'https://example.invalid/remapped-first.jar';
  const cache = await cacheStorage.open('mcsrc-v1');
  const firstSha1 = createHash('sha1').update('first').digest('hex');
  const secondSha1 = createHash('sha1').update('second').digest('hex');
  try {
    configureJarCache(url, firstSha1, directory);
    await cache.put(url, new Response('first'));
    await cache.put(remapped, new Response('remapped first'));
    configureJarCache(url, secondSha1, directory);
    await cache.put(url, new Response('second'));
    configureJarCache(url, firstSha1, directory);
    assert.equal(await cache.match(remapped), undefined);
    assert.equal(await cache.match(url), undefined);
    await cache.put(url, new Response('first'));
    assert.equal(await (await cache.match(remapped))?.text(), 'remapped first');
    assert.equal(await readFile(join(directory, 'client.jar'), 'utf8'), 'first');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
