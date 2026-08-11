import {
  Channel,
  Collection,
  CollectionService,
  EventBus,
  LanguageCode,
  Product,
  ProductService,
  RequestContext,
  TransactionalConnection,
} from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';
import { ContentCheckMessage, ContentHealthPluginOptions } from '../types';
import { ContentCheckResult } from '../entities/content-check-result.entity';
import { ContentCheckResultService } from './content-check-result.service';
import { ContentCheckService } from './content-check.service';
import { SitemapFetcher } from './sitemap-fetcher';
import { PageFetchResult, StorefrontPageFetcher } from './storefront-page-fetcher';

function createService(options: ContentHealthPluginOptions) {
  const saveResult = vi.fn(
    (
      ctx: RequestContext,
      input: { messages: ContentCheckMessage[] }
    ): Promise<ContentCheckResult> =>
      Promise.resolve({
        ...input,
        id: '1',
      } as unknown as ContentCheckResult)
  );
  const resultService = { saveResult } as unknown as ContentCheckResultService;

  const fetch = vi.fn(
    (): Promise<PageFetchResult> =>
      Promise.resolve({ ok: false, error: 'not used in this test' })
  );
  const pageFetcher = { fetch } as unknown as StorefrontPageFetcher;

  const sitemapFetcher = { fetch: vi.fn() } as unknown as SitemapFetcher;

  const service = new ContentCheckService(
    undefined as unknown as TransactionalConnection, // unused by checkEntity
    undefined as unknown as ProductService, // unused by checkEntity
    undefined as unknown as CollectionService, // unused by checkEntity
    undefined as unknown as EventBus, // unused by checkEntity
    pageFetcher,
    sitemapFetcher,
    resultService,
    options
  );
  return { service, saveResult };
}

const channel = {
  id: '1',
  code: 'default',
  availableLanguageCodes: [LanguageCode.en],
  defaultLanguageCode: LanguageCode.en,
} as unknown as Channel;
const ctx = {} as unknown as RequestContext;

function createEntity(
  excludedFromContentChecks: boolean
): Product | Collection {
  return {
    id: '10',
    customFields: { excludedFromContentChecks },
  } as unknown as Product;
}

describe('ContentCheckService.checkEntity', () => {
  it('short-circuits an excluded entity: no result is written, no error is produced', async () => {
    const { service, saveResult } = createService({
      getStorefrontUrl: vi.fn(),
    });

    const result = await service.checkEntity(
      ctx,
      'product',
      createEntity(true),
      channel,
      LanguageCode.en
    );

    expect(result).toBeUndefined();
    expect(saveResult).not.toHaveBeenCalled();
  });

  it('turns a thrown configurable check into a single internal error, without stopping the remaining checks', async () => {
    const throwingCheck = vi.fn(() => {
      throw new Error('boom');
    });
    const passingCheck = vi.fn(
      (): ContentCheckMessage[] => [
        { source: 'demo', severity: 'warning', code: 'DEMO', message: 'ok' },
      ]
    );
    const { service, saveResult } = createService({
      // Forces URL_UNRESOLVABLE, so the page fetch is skipped.
      getStorefrontUrl: vi.fn(() => Promise.resolve(undefined)),
      checks: { product: [throwingCheck, passingCheck] },
    });

    await service.checkEntity(
      ctx,
      'product',
      createEntity(false),
      channel,
      LanguageCode.en
    );

    expect(throwingCheck).toHaveBeenCalledTimes(1);
    expect(passingCheck).toHaveBeenCalledTimes(1);

    const savedInput = saveResult.mock.calls[0][1];
    const internalErrors = savedInput.messages.filter(
      (m) => m.code === 'INTERNAL_CHECK_ERROR'
    );
    expect(internalErrors).toHaveLength(1);
    expect(savedInput.messages.some((m) => m.code === 'DEMO')).toBe(true);
  });
});
