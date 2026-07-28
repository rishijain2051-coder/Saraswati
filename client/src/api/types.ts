export interface User {
  id: number;
  name: string;
  email: string;
  role: 'Admin' | 'Manager' | 'Operator' | 'Viewer' | string;
  isActive?: boolean;
}

export interface Currency {
  id: number;
  code: string;
  name: string;
  symbol: string;
  rateToBase: number;
  isBase: boolean;
  isActive: boolean;
}

export interface Unit {
  id: number;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface AttributeValue {
  id: number;
  type: string;
  value: string;
  code?: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface Buyer {
  id: number;
  code: string;
  name: string;
  country?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  isActive: boolean;
}

export interface Meta {
  heads: { code: string; label: string; order: number }[];
  methods: {
    code: string;
    label: string;
    measureUnit: string;
    expression: string;
    dims: ('L' | 'W' | 'H')[];
    usesWeight: boolean;
    usesWastage: boolean;
    dimUnit?: 'IN' | 'CM' | null;
    hint: string;
  }[];
  roles: string[];
  attributeTypes: { type: string; label: string }[];
  relationTypes: { code: string; label: string }[];
  productStatuses: string[];
}

export interface CostLine {
  id?: number;
  name: string;
  qty: number;
  wastagePct: number;
  actualL?: number | null;
  actualW?: number | null;
  actualH?: number | null;
  costL?: number | null;
  costW?: number | null;
  costH?: number | null;
  actualWeight?: number | null;
  unit?: string | null;
  rate: number;
  sortOrder?: number;
  measure?: number;
  amount?: number;
}

export interface CostGroup {
  id?: number;
  head: string;
  name: string;
  method: string;
  dimUnit?: string | null;
  sortOrder?: number;
  notes?: string | null;
  lines: CostLine[];
  total?: number;
}

export interface CostSummary {
  headTotals: Record<string, number>;
  exFactory: number;
  forwarding: number;
  factoryExpense: number;
  margin: number;
  fob: number;
  nonFobFactoryExpense: number;
  nonFobMargin: number;
  nonFob: number;
  factoryExpensePct: number;
  marginPct: number;
}

export interface CostSheet {
  id?: number;
  currencyId?: number | null;
  currency?: Currency | null;
  factoryExpensePct: number;
  marginPct: number;
  notes?: string | null;
  groups: CostGroup[];
  summary?: CostSummary;
  updatedAt?: string;
  createdAt?: string;
}

export interface ProductBuyerLink {
  id?: number;
  buyerId: number;
  buyerCode?: string | null;
  buyer?: Buyer;
}

export interface RelatedLink {
  id?: number;
  relatedId: number;
  relation: string;
  note?: string | null;
  product?: { id: number; factoryCode: string; name: string; primaryImage?: string | null };
}

export interface ProductImage {
  id: number;
  url: string;
  filename: string;
  originalName?: string | null;
  isPrimary: boolean;
  caption?: string | null;
  sortOrder: number;
}

export interface ProductSummary {
  id: number;
  factoryCode: string;
  name: string;
  alias?: string | null;
  status: string;
  productType?: string | null;
  size?: string | null;
  colour?: string | null;
  material?: string | null;
  unit?: string | null;
  buyers: { name: string; code: string; buyerCode?: string | null }[];
  primaryImage?: string | null;
  currency?: { code: string; symbol: string } | null;
  exFactory?: number | null;
  fob?: number | null;
  nonFob?: number | null;
  updatedAt: string;
}

export interface ProductDetail {
  id: number;
  factoryCode: string;
  name: string;
  alias?: string | null;
  status: string;
  description?: string | null;
  notes?: string | null;
  itemTypeId?: number | null;
  productTypeId?: number | null;
  sizeId?: number | null;
  colourId?: number | null;
  materialId?: number | null;
  finishId?: number | null;
  unitId?: number | null;
  stageLineId?: number | null;
  prodLengthIn?: number | null;
  prodWidthIn?: number | null;
  prodHeightIn?: number | null;
  netWeightKg?: number | null;
  grossWeightKg?: number | null;
  packLengthIn?: number | null;
  packWidthIn?: number | null;
  packHeightIn?: number | null;
  piecesPerCarton?: number | null;
  volumeBeforePackingCbm?: number | null;
  volumeAfterPackingCbm?: number | null;
  itemType?: AttributeValue | null;
  productType?: AttributeValue | null;
  size?: AttributeValue | null;
  colour?: AttributeValue | null;
  material?: AttributeValue | null;
  finish?: AttributeValue | null;
  unit?: Unit | null;
  stageLine?: { id: number; code: string; name: string; steps: { id: number; name: string; sortOrder: number }[] } | null;
  createdBy?: { id: number; name: string } | null;
  buyers: ProductBuyerLink[];
  images: ProductImage[];
  related: RelatedLink[];
  costSheet?: CostSheet | null;
  updatedAt: string;
  createdAt: string;
}
