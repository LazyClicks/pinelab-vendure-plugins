import nock from 'nock';
import { afterEach, describe, expect, it } from 'vitest';
import { StorefrontPageFetcher } from './storefront-page-fetcher';

describe('StorefrontPageFetcher', () => {
  const fetcher = new StorefrontPageFetcher();

  afterEach(() => nock.cleanAll());

  it('succeeds within the redirect limit', async () => {
    nock('https://shop.example.com')
      .get('/a')
      .reply(302, undefined, { Location: 'https://shop.example.com/b' })
      .get('/b')
      .reply(200, '<html><title>Hi</title></html>');

    const result = await fetcher.fetch('https://shop.example.com/a', {
      maxRedirects: 5,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toContain('Hi');
    }
  });

  it('fails when the redirect chain exceeds the configured maximum', async () => {
    nock('https://shop.example.com')
      .get('/a')
      .reply(302, undefined, { Location: 'https://shop.example.com/b' })
      .get('/b')
      .reply(302, undefined, { Location: 'https://shop.example.com/c' })
      .get('/c')
      .reply(200, 'ok');

    const result = await fetcher.fetch('https://shop.example.com/a', {
      maxRedirects: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/redirect limit/i);
    }
  });

  it('fails on an unreachable host (connection error)', async () => {
    nock('https://shop.example.com')
      .get('/down')
      .replyWithError({ message: 'connection refused', code: 'ECONNREFUSED' });

    const result = await fetcher.fetch('https://shop.example.com/down');

    expect(result.ok).toBe(false);
  });

  it('fails on a non-2xx final response', async () => {
    nock('https://shop.example.com').get('/missing').reply(404, 'not found');

    const result = await fetcher.fetch('https://shop.example.com/missing');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/404/);
    }
  });
});
