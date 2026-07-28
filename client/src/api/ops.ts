import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { Buyer, Currency } from './types';

export const ORDER_STATUSES = ['Confirmed', 'Production', 'Ready', 'Shipped', 'Closed', 'Cancelled'];
export const PROFORMA_STATUSES = ['Draft', 'Sent', 'Accepted', 'Rejected'];
export const STAGE_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'DONE'];
export const PARTY_TYPES = ['SUPPLIER', 'JOBWORK', 'BUYER', 'WORKER'];

export interface Supplier {
  id: number;
  code: string;
  name: string;
  type: 'MATERIAL' | 'JOBWORK' | 'BOTH' | string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  gstNo?: string | null;
  address?: string | null;
  paymentTerms?: string | null;
  isActive: boolean;
}

export interface RawItem {
  id: number;
  code: string;
  name: string;
  category?: string | null;
  unit: string;
  reorderLevel: number;
  openingQty: number;
  isActive: boolean;
  inQty: number;
  outQty: number;
  balance: number;
  low: boolean;
}

export interface StockTxn {
  id: number;
  rawItemId: number;
  type: 'IN' | 'OUT';
  qty: number;
  rate: number;
  supplierId?: number | null;
  orderRef?: string | null;
  note?: string | null;
  date: string;
  rawItem?: { name: string; unit: string };
  supplier?: { name: string } | null;
}

export interface OrderLineDto {
  id?: number;
  productId: number;
  qty: number;
  unitPrice: number;
  product?: { id: number; factoryCode: string; name: string };
  planned?: number;
  produced?: number;
  pending?: number;
  sheetCount?: number;
}

export interface Order {
  id: number;
  number: string;
  buyerId: number;
  buyer: Buyer;
  currencyId?: number | null;
  currency?: Currency | null;
  status: string;
  orderDate: string;
  deliveryDate?: string | null;
  incoterms?: string | null;
  notes?: string | null;
  exchangeRate?: number | null;
  proforma?: { id: number; number: string } | null;
  sheets?: { id: number; number: string; status: string; productId: number; qty: number; producedQty: number; mode: string }[];
  lines: OrderLineDto[];
  total: number;
  totalOrdered?: number;
  totalProduced?: number;
  totalPending?: number;
}

export interface ProformaLineDto {
  id?: number;
  productId?: number | null;
  description: string;
  qty: number;
  unitPrice: number;
  product?: { id: number; factoryCode: string; name: string } | null;
}

export interface Proforma {
  id: number;
  number: string;
  buyerId: number;
  buyer: Buyer;
  currencyId?: number | null;
  currency?: Currency | null;
  status: string;
  date: string;
  validUntil?: string | null;
  paymentTerms?: string | null;
  deliveryTerms?: string | null;
  incoterms?: string | null;
  bankDetails?: string | null;
  notes?: string | null;
  exchangeRate?: number | null;
  order?: { id: number; number: string } | null;
  lines: ProformaLineDto[];
  total: number;
}

export interface OpStage {
  id: number;
  name: string;
  sortOrder: number;
  mode: 'INHOUSE' | 'OUTSOURCED' | string;
  vendorId?: number | null;
  vendor?: { id: number; name: string } | null;
  jobworkCost: number;
  status: string;
  qtyDone: number;
  assignee?: string | null;
  note?: string | null;
}

export interface OpExplosion {
  currency?: { code: string; symbol: string } | null;
  perPiece: {
    headTotals: Record<string, number>;
    exFactory: number;
    forwarding: number;
    fob: number;
    nonFob: number;
    factoryExpensePct: number;
    marginPct: number;
  };
  order: {
    qty: number;
    headTotals: Record<string, number>;
    exFactory: number;
    forwarding: number;
    fob: number;
    nonFob: number;
  };
  groups: {
    head: string;
    name: string;
    method: string;
    total: number;
    orderTotal: number;
    lines: { name: string; unit?: string | null; measure: number; amount: number; orderMeasure: number; orderAmount: number }[];
  }[];
}

export interface OperationSheet {
  id: number;
  number: string;
  productId: number;
  product: { id: number; factoryCode: string; name: string; unit?: { code: string } | null };
  orderId?: number | null;
  order?: { id: number; number: string } | null;
  qty: number;
  producedQty: number;
  mode: 'INHOUSE' | 'OUTSOURCED' | string;
  vendorId?: number | null;
  vendor?: { id: number; name: string } | null;
  jobworkCost: number;
  status: string;
  notes?: string | null;
  stages: OpStage[];
  explosion?: OpExplosion | null;
  existing?: boolean;
}

export interface LedgerEntry {
  id: number;
  partyType: string;
  supplierId?: number | null;
  buyerId?: number | null;
  partyName: string;
  kind: 'BILL' | 'PAYMENT';
  amount: number;
  currency?: string | null;
  date: string;
  ref?: string | null;
  note?: string | null;
  supplier?: { name: string } | null;
  buyer?: { name: string } | null;
}

export interface PartyDue {
  partyType: string;
  partyName: string;
  supplierId: number | null;
  buyerId: number | null;
  billed: number;
  paid: number;
  balance: number;
}

export interface OpsDashboard {
  pendingOrders: number;
  inProduction: number;
  receivable: number;
  payable: number;
  recentProformas: { id: number; number: string; buyer: string; status: string; date: string }[];
  lowStock: { id: number; name: string; unit: string; balance: number; reorderLevel: number }[];
}

const get = async <T>(url: string, params?: Record<string, unknown>) => (await api.get<T>(url, { params })).data;

export const useSuppliers = (type?: string) => useQuery({ queryKey: ['suppliers', type ?? 'all'], queryFn: () => get<Supplier[]>('/suppliers', type ? { type } : {}) });
export const useRawItems = () => useQuery({ queryKey: ['raw-items'], queryFn: () => get<RawItem[]>('/raw-items') });
export const useStockTxns = (rawItemId?: number) => useQuery({ queryKey: ['stock-txns', rawItemId ?? 'all'], queryFn: () => get<StockTxn[]>('/stock/txns', rawItemId ? { rawItemId } : {}) });
export const useOrders = (status?: string) => useQuery({ queryKey: ['orders', status ?? 'all'], queryFn: () => get<Order[]>('/orders', status ? { status } : {}) });
export const useOrder = (id?: number | string) => useQuery({ enabled: id != null && id !== 'new', queryKey: ['order', id], queryFn: () => get<Order>(`/orders/${id}`) });
export const useProformas = (status?: string) => useQuery({ queryKey: ['proformas', status ?? 'all'], queryFn: () => get<Proforma[]>('/proformas', status ? { status } : {}) });
export const useProforma = (id?: number | string) => useQuery({ enabled: id != null && id !== 'new', queryKey: ['proforma', id], queryFn: () => get<Proforma>(`/proformas/${id}`) });
export const useSheets = (status?: string) => useQuery({ queryKey: ['op-sheets', status ?? 'all'], queryFn: () => get<OperationSheet[]>('/operation-sheets', status ? { status } : {}) });
export const useSheet = (id?: number | string) => useQuery({ enabled: id != null, queryKey: ['op-sheet', id], queryFn: () => get<OperationSheet>(`/operation-sheets/${id}`) });
export const usePayments = (params: Record<string, unknown> = {}) => useQuery({ queryKey: ['payments', params], queryFn: () => get<LedgerEntry[]>('/payments', params) });
export const useParties = () => useQuery({ queryKey: ['parties'], queryFn: () => get<PartyDue[]>('/payments/parties') });
export const useOpsDashboard = () => useQuery({ queryKey: ['ops-dashboard'], queryFn: () => get<OpsDashboard>('/ops/dashboard') });

export async function suggestPrice(productId: number, currencyId?: number) {
  return get<{ fobInr: number; rate: number; currencyCode: string; suggested: number }>('/ops/price', { productId, currencyId });
}
