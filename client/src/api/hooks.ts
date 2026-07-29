import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { AttributeValue, Buyer, Company, Currency, Meta, ProductDetail, ProductSummary, Unit } from './types';

export const useMeta = () =>
  useQuery({ queryKey: ['meta'], queryFn: async () => (await api.get<Meta>('/meta')).data, staleTime: Infinity });

export const useCurrencies = () =>
  useQuery({ queryKey: ['currencies'], queryFn: async () => (await api.get<Currency[]>('/currencies')).data });

export const useUnits = () =>
  useQuery({ queryKey: ['units'], queryFn: async () => (await api.get<Unit[]>('/units')).data });

export const useBuyers = () =>
  useQuery({ queryKey: ['buyers'], queryFn: async () => (await api.get<Buyer[]>('/buyers')).data });

/**
 * Who WE are. Needed wherever tax is worked out, because comparing our state with the
 * buyer's is what decides CGST+SGST versus IGST.
 */
export const useCompany = () =>
  useQuery({ queryKey: ['company'], queryFn: async () => (await api.get<Company>('/company')).data, staleTime: 5 * 60 * 1000 });

export const useAttributes = (type?: string) =>
  useQuery({
    queryKey: ['attributes', type ?? 'all'],
    queryFn: async () => (await api.get<AttributeValue[]>('/attributes', { params: type ? { type } : {} })).data,
  });

export interface ProductFilters {
  q?: string;
  status?: string;
  productTypeId?: number;
  sizeId?: number;
  colourId?: number;
  materialId?: number;
  finishId?: number;
  buyerId?: number;
}

export const useProducts = (filters: ProductFilters = {}) =>
  useQuery({
    queryKey: ['products', filters],
    queryFn: async () => (await api.get<ProductSummary[]>('/products', { params: filters })).data,
  });

export const useProduct = (id?: number | string) =>
  useQuery({
    enabled: id != null && id !== 'new',
    queryKey: ['product', id],
    queryFn: async () => (await api.get<ProductDetail>(`/products/${id}`)).data,
  });
