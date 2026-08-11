import {
  api,
  DashboardBaseWidget,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@vendure/dashboard';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { contentCheckOverviewForWidgetDocument } from '../queries';

const WIDGET_ITEM_LIMIT = 10;

function detailUrl(entityType: string, entityId: string): string {
  return entityType === 'PRODUCT'
    ? `/products/${entityId}`
    : `/collections/${entityId}`;
}

/**
 * Dashboard home page widget listing products/collections that currently
 * have at least one warning or error, each linking to its own detail page.
 */
export function ContentCheckOverviewWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['content-health-overview'],
    queryFn: () =>
      api.query(contentCheckOverviewForWidgetDocument, {
        options: { take: WIDGET_ITEM_LIMIT, sort: { hasError: 'DESC' } },
      }),
  });

  const items = data?.contentCheckOverview.items ?? [];
  const totalItems = data?.contentCheckOverview.totalItems ?? 0;
  const hasMore = totalItems > items.length;

  return (
    <DashboardBaseWidget
      id="content-health-overview"
      title="SEO / content issues"
      description="Products and collections with current warnings or errors"
    >
      {isLoading ? (
        <div className="animate-pulse space-y-2">
          <div className="h-8 bg-muted rounded-md" />
          <div className="h-8 bg-muted rounded-md" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No products or collections currently have SEO/content issues.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="max-h-[300px] overflow-y-auto">
            <Table>
              <TableBody>
                {items.map((item) => (
                  <TableRow
                    key={`${item.entityType}-${item.entityId}`}
                    className={item.hasError ? 'bg-destructive/10' : undefined}
                  >
                    <TableCell>
                      <a
                        href={detailUrl(item.entityType, item.entityId)}
                        className="hover:underline"
                      >
                        {item.name}
                      </a>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {item.entityType === 'PRODUCT' ? 'Product' : 'Collection'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Link
            to="/content-health/issues"
            className="text-sm text-muted-foreground hover:underline"
          >
            {hasMore ? `View all ${totalItems} issues →` : 'View all issues →'}
          </Link>
        </div>
      )}
    </DashboardBaseWidget>
  );
}
