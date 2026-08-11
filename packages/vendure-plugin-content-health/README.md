# Vendure content / SEO monitor plugin

Validates both Vendure catalog data and the actual rendered storefront output for products and collections, per channel and per enabled language, and surfaces the results directly where merchandisers already work: the product/collection detail page, a dashboard overview, and live error notifications.

## What it checks

Built-in, non-configurable checks against the storefront page's rendered HTML (fetched with a plain HTTP GET, following redirects):

- Meta title length (30-60 characters valid, recommended 50-60)
- Meta description length (100-160 characters valid, recommended 140-160)
- Hreflang completeness (every enabled language represented), reciprocity, and the presence of `x-default`
- Required JSON-LD structured data: products need `Product`, `ProductGroup`, `BreadcrumbList`, and at least one of `Organization`/`OnlineStore`; collections need `BreadcrumbList`
- Sitemap inclusion: the resolved URL must appear in the configured sitemap

On top of that, you can register your own **Vendure content checks** — checks against Vendure catalog data itself (as opposed to the rendered page) — via the `checks` option. No built-in Vendure-data checks ship with the plugin.

Only the latest result per (product-or-collection, channel, language) is kept; a new check fully replaces the previous one. No history/trend data is stored.

## Getting started

```ts
import { ContentHealthPlugin } from '@pinelab/vendure-plugin-content-health';

plugins: [
  ContentHealthPlugin.init({
    // Required: resolve the storefront URL for a product/collection, channel and language.
    // Returning `undefined` for a non-excluded entity is recorded as an error, not silently skipped.
    getStorefrontUrl: (ctx, { entityType, entity, channel, languageCode }) => {
      const kind = entityType === 'product' ? 'products' : 'collections';
      return `https://storefront.example.com/${languageCode}/${kind}/${entity.slug}`;
    },
    // Optional: resolve the sitemap to check URL inclusion against, per channel/language.
    // Omit (or return `undefined`) to skip the sitemap-inclusion check for a channel/language.
    getSitemapUrl: (ctx, { channel, languageCode }) =>
      `https://storefront.example.com/${languageCode}/sitemap.xml`,
    // Optional, defaults shown:
    maxRedirects: 5,
    requestTimeoutMs: 10000,
    concurrency: 5,
    // Optional: change when the full scan runs (default: nightly at 3:00 AM).
    scheduledTask: { schedule: (cron) => cron.everyDayAt(4, 0) },
    // Optional: your own checks against Vendure catalog data.
    checks: {
      product: [
        (ctx, { entity }) => {
          if (!entity.description || entity.description.length < 20) {
            return [
              {
                source: 'my-description-check',
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
      collection: [],
    },
  }),
];
```

The dashboard extensions are provided as a React Dashboard extension — no Admin UI compilation step is needed:

- A findings block on the product/collection detail page (with a "Check now" button and the exclusion notice).
- A dashboard-home overview widget, linking through to the full issues page.
- A full, filterable, paginated **"SEO / content issues" list page** under the Catalog nav section (`/content-health/issues`), listing every product/collection with a current warning or error — deduplicated across every language it was checked in, with an error/warning count, a message preview, and the affected languages. Supports searching by name and filtering by type (Product/Collection) and severity (errors vs. warnings-only). Each row has a "Go to product"/"Go to collection" button for direct navigation, and clicking the name goes to this plugin's own **issue detail page** (`/content-health/issues/product|collection/:id`), which shows the entity's full findings across every checked language, a "Check now" button, and its own "Go to product"/"Go to collection" link. A deleted entity is shown with a "could not be found" state rather than a broken link; a blank/whitespace-only name falls back to `Untitled product #<id>` / `Untitled collection #<id>`.
- An error-only alert, also linking through to the issues list.

## Custom fields

Adds an `excludedFromContentChecks` boolean custom field to both `Product` and `Collection` (default `false`). When enabled, the entity is skipped by every scheduled full scan, on-demand full scan, and update-triggered check, and its detail page shows a warning that it is excluded from SEO/content checks and probably not live.

## Triggers

- **Scheduled full scan**: registered as a `ScheduledTask` (id `content-health-full-scan`), checking every non-excluded product and collection across every enabled channel and language. Runnable on demand via Vendure's built-in Scheduled Tasks admin screen. Requires a scheduler plugin (e.g. `DefaultSchedulerPlugin`) to actually run on a schedule.
- **Per-entity check on update**: whenever a product or collection is updated, it is automatically re-checked across all of its resolved channel/language combinations — no action needed.
- **Manual check, per entity**: a "Check now" button on the product/collection detail page (in the findings block) re-checks just that entity on demand, without needing to edit it. Backed by the `runContentCheckForProduct`/`runContentCheckForCollection` mutations (`Permission.UpdateProduct`/`Permission.UpdateCollection`). Unlike the automatic recheck on update — which re-checks every channel the entity belongs to, since editing shared content can affect the outcome everywhere it's used — the manual check is scoped to the active channel only, so triggering it from Channel A never reads or writes results for Channel B.
- **Manual check, full catalog**: a "Run full scan now" button on the "SEO / content issues" dashboard page. Backed by the `runContentHealthFullScan` mutation (`Permission.UpdateCatalog`), which awaits the same `runFullScan()` used by the scheduled task. On a very large catalog this may take a while and could exceed typical HTTP/GraphQL request timeouts — for large catalogs, prefer the Scheduled Tasks admin screen's "Run" action instead, since that execution isn't bound by a request timeout.

Root collections (`isRoot: true`) are skipped, since they don't correspond to a real storefront page.

## Event

`ChannelContentScanCompletedEvent` is published once per channel at the end of a full scan (not for per-entity update-triggered checks), carrying that channel's findings for every language and entity checked during the scan — including page-fetch and sitemap failures. Subscribe to it to build things like an email report, without polling the stored results:

```ts
eventBus
  .ofType(ChannelContentScanCompletedEvent)
  .subscribe(({ channel, findings }) => {
    // findings: Array<{ entityType, entityId, languageCode, url, hasError, hasWarning, messages, checkedAt }>
  });
```

## Admin API

- `contentCheckResults(entityType: ContentCheckEntityType!, entityId: ID!): [ContentCheckResult!]!` — latest results for a single entity, scoped to the active channel, across every language it was checked in.
- `contentCheckOverview(options: ContentCheckOverviewListOptions): ContentCheckOverviewList!` — a standard Vendure paginated list of every product/collection in the active channel with at least one current warning or error. One row per entity (deduplicated across languages), with `errorCount`, `warningCount`, `languageCodes`, and a `preview` of the first error (or first warning) message. Supports `filter: { name, entityType, hasError, hasWarning }`, `sort`, `skip`/`take` like any other Vendure list query.
- `runContentCheckForProduct(productId: ID!): [ContentCheckResult!]!` — manually re-checks a single product now and returns its fresh results.
- `runContentCheckForCollection(collectionId: ID!): [ContentCheckResult!]!` — manually re-checks a single collection now and returns its fresh results.
- `runContentHealthFullScan: ContentHealthScanResult!` — manually runs a full scan now, the same as the scheduled task.
