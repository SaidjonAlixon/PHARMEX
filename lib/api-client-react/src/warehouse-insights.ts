import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { customFetch } from './custom-fetch';

export type WarehouseTopSeller = {
  rank: number;
  productId: number;
  productName: string;
  unit: string;
  stockQty: number;
  soldQty: number;
  sales: string;
  expiryDate?: string | null;
};

export type WarehouseSlowMover = {
  productId: number;
  productName: string;
  unit: string;
  stockQty: number;
  stockValue?: string | null;
  soldQty: number;
  lastSoldAt?: string | null;
  daysSinceSale?: number | null;
  expiryDate?: string | null;
  expiryDays?: number | null;
  expired: boolean;
};

export type WarehouseInsights = {
  topSellers: WarehouseTopSeller[];
  slowMovers: WarehouseSlowMover[];
};

export type GetWarehouseInsightsParams = {
  branchId?: number;
  dateFrom?: string;
  dateTo?: string;
};

function url(params?: GetWarehouseInsightsParams) {
  const q = new URLSearchParams();
  if (params?.branchId) q.set('branchId', String(params.branchId));
  if (params?.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params?.dateTo) q.set('dateTo', params.dateTo);
  const s = q.toString();
  return s ? `/api/warehouse-insights?${s}` : `/api/warehouse-insights`;
}

export const getWarehouseInsights = (params?: GetWarehouseInsightsParams) =>
  customFetch<WarehouseInsights>(url(params), { method: 'GET' });

export const getGetWarehouseInsightsQueryKey = (params?: GetWarehouseInsightsParams) =>
  [`/api/warehouse-insights`, ...(params ? [params] : [])] as const;

export function useGetWarehouseInsights(
  params?: GetWarehouseInsightsParams,
  options?: { query?: Partial<UseQueryOptions<WarehouseInsights, Error>> },
) {
  return useQuery({
    queryKey: getGetWarehouseInsightsQueryKey(params),
    queryFn: () => getWarehouseInsights(params),
    ...options?.query,
  });
}
