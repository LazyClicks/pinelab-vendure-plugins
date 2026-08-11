import nock from 'nock';
import { afterEach, describe, expect, it } from 'vitest';
import { SitemapFetcher } from './sitemap-fetcher';

describe('SitemapFetcher', () => {
  const fetcher = new SitemapFetcher();

  afterEach(() => nock.cleanAll());

  it('returns the URL set for a valid urlset sitemap', async () => {
    nock('https://shop.example.com')
      .get('/sitemap.xml')
      .reply(
        200,
        `<?xml version="1.0"?><urlset><url><loc>https://shop.example.com/a</loc></url><url><loc>https://shop.example.com/b</loc></url></urlset>`
      );

    const result = await fetcher.fetch('https://shop.example.com/sitemap.xml');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.urls.has('https://shop.example.com/a')).toBe(true);
      expect(result.urls.has('https://shop.example.com/b')).toBe(true);
      expect(result.urls.size).toBe(2);
    }
  });

  it('fails when the sitemap is unavailable', async () => {
    nock('https://shop.example.com').get('/sitemap.xml').reply(500);

    const result = await fetcher.fetch('https://shop.example.com/sitemap.xml');

    expect(result.ok).toBe(false);
  });

  it('fails when the sitemap is malformed', async () => {
    nock('https://shop.example.com')
      .get('/sitemap.xml')
      .reply(200, 'this is not xml at all {{{ <<<');

    const result = await fetcher.fetch('https://shop.example.com/sitemap.xml');

    expect(result.ok).toBe(false);
  });

  it('follows a sitemap index and isolates a broken child sitemap', async () => {
    nock('https://shop.example.com')
      .get('/sitemap.xml')
      .reply(
        200,
        `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://shop.example.com/sitemap-a.xml</loc></sitemap><sitemap><loc>https://shop.example.com/sitemap-b.xml</loc></sitemap></sitemapindex>`
      )
      .get('/sitemap-a.xml')
      .reply(
        200,
        `<?xml version="1.0"?><urlset><url><loc>https://shop.example.com/a</loc></url></urlset>`
      )
      .get('/sitemap-b.xml')
      .reply(500);

    const result = await fetcher.fetch('https://shop.example.com/sitemap.xml');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.urls.has('https://shop.example.com/a')).toBe(true);
      expect(result.urls.size).toBe(1);
    }
  });
});
