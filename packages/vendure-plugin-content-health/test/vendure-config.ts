require('dotenv').config();

import {
  DefaultLogger,
  DefaultSearchPlugin,
  dummyPaymentHandler,
  LogLevel,
  mergeConfig,
  VendureConfig,
} from '@vendure/core';
import { testConfig } from '@vendure/testing';
import { DashboardPlugin } from '@vendure/dashboard/plugin';
import path from 'path';
import { ContentHealthPlugin } from '../src';
import { MOCK_STOREFRONT_PORT } from './mock-storefront-server';

export const config: VendureConfig = mergeConfig(testConfig, {
  logger: new DefaultLogger({ level: LogLevel.Debug }),
  apiOptions: {
    adminApiPlayground: true,
    shopApiPlayground: true,
  },
  authOptions: {
    tokenMethod: ['cookie', 'bearer'],
  },
  paymentOptions: {
    paymentMethodHandlers: [dummyPaymentHandler],
  },
  plugins: [
    ContentHealthPlugin.init({
      getStorefrontUrl: (ctx, { entityType, entity, languageCode }) => {
        const kind = entityType === 'product' ? 'products' : 'collections';
        return `http://localhost:${MOCK_STOREFRONT_PORT}/${languageCode}/${kind}/${entity.slug}`;
      },
      getSitemapUrl: () =>
        `http://localhost:${MOCK_STOREFRONT_PORT}/sitemap.xml`,
      maxRedirects: 5,
      checks: {
        // Sample configurable Vendure content check: flag products with a
        // suspiciously short (or missing) description.
        product: [
          (ctx, { entity }) => {
            const description = (entity.description ?? '') as string;
            if (description.trim().length < 20) {
              return [
                {
                  source: 'demo-description-check',
                  severity: 'warning',
                  code: 'PRODUCT_DESCRIPTION_TOO_SHORT',
                  message:
                    'Product description should be at least 20 characters long.',
                },
              ];
            }
            return [];
          },
        ],
      },
    }),
    DefaultSearchPlugin,
    DashboardPlugin.init({
      // The route should correspond to the `base` setting
      // in the vite.config.mts file
      route: 'dashboard',
      // This appDir should correspond to the `build.outDir`
      // setting in the vite.config.mts file
      appDir: path.join(__dirname, '../dist/dashboard'),
    }),
  ],
});
