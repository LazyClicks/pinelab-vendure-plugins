import { CustomFieldConfig, LanguageCode } from '@vendure/core';
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  CustomCollectionFields,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  CustomProductFields,
} from '@vendure/core/dist/entity/custom-entity-fields';

declare module '@vendure/core' {
  interface CustomProductFields {
    excludedFromContentChecks?: boolean;
  }
  interface CustomCollectionFields {
    excludedFromContentChecks?: boolean;
  }
}

const label = [
  {
    languageCode: LanguageCode.en,
    value: 'Excluded from SEO/content checks',
  },
];

const description = [
  {
    languageCode: LanguageCode.en,
    value:
      'When enabled, this entity is skipped by all SEO/content scans and checks. Use this for entities that are intentionally not live on the storefront.',
  },
];

/**
 * Returns a fresh custom field config object each call, so the same
 * definition can be safely pushed onto both `Product` and `Collection`
 * without sharing object references between the two.
 */
export function buildExcludedFromContentChecksCustomField(): CustomFieldConfig {
  return {
    name: 'excludedFromContentChecks',
    type: 'boolean',
    defaultValue: false,
    public: false,
    label,
    description,
  };
}
