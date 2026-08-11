import {
  Badge,
  Button,
  DashboardRouteDefinition,
  DetailPageButton,
  ListPage,
} from '@vendure/dashboard';
import { AlertTriangleIcon, ExternalLinkIcon } from 'lucide-react';
import { contentCheckOverviewListDocument } from '../queries';

function issueDetailHref(entityType: string, entityId: string): string {
  return `/content-health/issues/${entityType.toLowerCase()}/${entityId}`;
}

function editEntityHref(entityType: string, entityId: string): string {
  return entityType === 'PRODUCT'
    ? `/products/${entityId}`
    : `/collections/${entityId}`;
}

export const contentCheckIssuesListRoute: DashboardRouteDefinition = {
  path: '/content-health/issues',
  loader: () => ({ breadcrumb: 'SEO / content issues' }),
  component: (route) => (
    <ListPage
      pageId="content-health-issues-list"
      title="SEO / content issues"
      listQuery={contentCheckOverviewListDocument}
      route={route}
      onSearchTermChange={(term) => ({ name: { contains: term } })}
      facetedFilters={{
        entityType: {
          title: 'Type',
          options: [
            { label: 'Product', value: 'PRODUCT' },
            { label: 'Collection', value: 'COLLECTION' },
          ],
        },
        hasError: {
          title: 'Severity',
          options: [
            { label: 'Has errors', value: true },
            { label: 'Warnings only', value: false },
          ],
        },
      }}
      customizeColumns={{
        name: {
          cell: ({ row }) => (
            <DetailPageButton
              href={issueDetailHref(row.original.entityType, row.original.entityId)}
              label={row.original.name}
            />
          ),
        },
        entityType: {
          header: 'Type',
          cell: ({ row }) => (
            <span className="text-muted-foreground">
              {row.original.entityType === 'PRODUCT' ? 'Product' : 'Collection'}
            </span>
          ),
        },
        hasError: {
          header: 'Status',
          meta: { dependencies: ['hasWarning', 'errorCount', 'warningCount'] },
          cell: ({ row }) => (
            <div className="flex gap-1 flex-wrap">
              {row.original.hasError && (
                <Badge variant="destructive">
                  {row.original.errorCount} error
                  {row.original.errorCount === 1 ? '' : 's'}
                </Badge>
              )}
              {row.original.hasWarning && (
                <Badge variant="outline">
                  {row.original.warningCount} warning
                  {row.original.warningCount === 1 ? '' : 's'}
                </Badge>
              )}
            </div>
          ),
        },
        hasWarning: { meta: { disabled: true } },
        errorCount: { meta: { disabled: true } },
        warningCount: { meta: { disabled: true } },
        preview: {
          header: 'Preview',
          cell: ({ row }) => (
            <span
              className="block max-w-md truncate text-sm text-muted-foreground"
              title={row.original.preview ?? undefined}
            >
              {row.original.preview ?? '—'}
            </span>
          ),
        },
        languageCodes: {
          header: 'Languages',
          cell: ({ row }) => (
            <div className="flex flex-wrap gap-1">
              {row.original.languageCodes.map((languageCode) => (
                <Badge key={languageCode} variant="outline">
                  {languageCode}
                </Badge>
              ))}
            </div>
          ),
        },
      }}
      additionalColumns={{
        goToEntity: {
          header: '',
          cell: ({ row }) => {
            const entityType = row.original.entityType;
            const label =
              entityType === 'PRODUCT' ? 'Go to product' : 'Go to collection';
            return (
              <Button
                variant="ghost"
                size="icon"
                title={label}
                render={
                  <a href={editEntityHref(entityType, row.original.entityId)} />
                }
              >
                <ExternalLinkIcon className="h-4 w-4" />
                <span className="sr-only">{label}</span>
              </Button>
            );
          },
        },
      }}
      defaultColumnOrder={[
        'name',
        'entityType',
        'hasError',
        'preview',
        'languageCodes',
        'goToEntity',
      ]}
      defaultVisibility={{
        name: true,
        entityType: true,
        hasError: true,
        preview: true,
        languageCodes: true,
        goToEntity: true,
      }}
      defaultSort={[{ id: 'hasError', desc: true }]}
    />
  ),
  navMenuItem: {
    sectionId: 'catalog',
    id: 'content-health-issues',
    title: 'SEO / content issues',
    icon: AlertTriangleIcon,
  },
};
