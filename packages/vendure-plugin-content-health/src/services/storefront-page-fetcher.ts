import { Injectable } from '@nestjs/common';
import axios from 'axios';

export type PageFetchResult =
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; error: string };

export interface PageFetchOptions {
  maxRedirects?: number;
  timeoutMs?: number;
}

/**
 * @description
 * Fetches a storefront page, following redirects up to a configurable
 * maximum and treating any final 2xx response as success. Never throws —
 * failures are returned as a typed `{ ok: false }` result.
 */
@Injectable()
export class StorefrontPageFetcher {
  async fetch(
    url: string,
    options: PageFetchOptions = {}
  ): Promise<PageFetchResult> {
    const maxRedirects = options.maxRedirects ?? 5;
    const timeout = options.timeoutMs ?? 10000;
    try {
      const response = await axios.get<string>(url, {
        maxRedirects,
        timeout,
        responseType: 'text',
        validateStatus: () => true,
      });
      if (response.status < 200 || response.status >= 300) {
        return {
          ok: false,
          error: `Received non-2xx status ${response.status} when fetching '${url}'.`,
        };
      }
      const request = response.request as
        | { res?: { responseUrl?: string } }
        | undefined;
      const finalUrl = request?.res?.responseUrl ?? url;
      return { ok: true, html: response.data, finalUrl };
    } catch (e) {
      const err = e as { message?: string; code?: string };
      const isRedirectLimitError =
        err?.code === 'ERR_FR_TOO_MANY_REDIRECTS' ||
        /maximum number of redirects/i.test(err?.message ?? '');
      if (isRedirectLimitError) {
        return {
          ok: false,
          error: `Redirect limit of ${maxRedirects} exceeded when fetching '${url}'.`,
        };
      }
      return {
        ok: false,
        error: `Failed to fetch '${url}': ${err?.message ?? 'unknown error'}`,
      };
    }
  }
}
