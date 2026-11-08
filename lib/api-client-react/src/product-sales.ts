import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { customFetch } from './custom-fetch';
import type { Sale } from './generated/api.schemas';

export type GetProductSalesParams = {
  productId: number;
  branchId?: number;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
};

function url(params: GetProductSalesParams) {
  const q = new URLSearchParams();
  q.set('productId', String(params.productId));
  if (params.branchId) q.set('branchId', String(params.branchId));
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  if (params.limit) q.set('limit', String(params.limit));
  return `/api/product-sales?${q}`;
}

export const getProductSales = (params: GetProductSalesParams) =>
  customFetch<Sale[]>(url(params), { method: 'GET' });

export const getGetProductSalesQueryKey = (params: GetProductSalesParams) =>
  [`/api/product-sales`, params] as const;

export function useGetProductSales(
  params: GetProductSalesParams,
  options?: { query?: Partial<UseQueryOptions<Sale[], Error>> },
) {
  return useQuery({
    queryKey: getGetProductSalesQueryKey(params),
    queryFn: () => getProductSales(params),
    enabled: params.productId > 0,
    ...options?.query,
  });
}
