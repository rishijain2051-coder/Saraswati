import type { CostGroup, ProductDetail } from '../../../api/types';

export interface WizardDraft {
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
  buyers: { buyerId: number; buyerCode?: string | null }[];
  related: { relatedId: number; relation: string; note?: string | null }[];
  costSheet: {
    currencyId?: number | null;
    factoryExpensePct: number;
    marginPct: number;
    notes?: string | null;
    groups: CostGroup[];
  };
}

export function emptyDraft(currencyId?: number): WizardDraft {
  return {
    factoryCode: '',
    name: '',
    status: 'Draft',
    buyers: [],
    related: [],
    costSheet: { currencyId: currencyId ?? null, factoryExpensePct: 15, marginPct: 15, groups: [] },
  };
}

export function fromProduct(p: ProductDetail): WizardDraft {
  return {
    factoryCode: p.factoryCode,
    name: p.name,
    alias: p.alias,
    status: p.status,
    description: p.description,
    notes: p.notes,
    itemTypeId: p.itemTypeId,
    productTypeId: p.productTypeId,
    sizeId: p.sizeId,
    colourId: p.colourId,
    materialId: p.materialId,
    finishId: p.finishId,
    unitId: p.unitId,
    prodLengthIn: p.prodLengthIn,
    prodWidthIn: p.prodWidthIn,
    prodHeightIn: p.prodHeightIn,
    netWeightKg: p.netWeightKg,
    grossWeightKg: p.grossWeightKg,
    packLengthIn: p.packLengthIn,
    packWidthIn: p.packWidthIn,
    packHeightIn: p.packHeightIn,
    piecesPerCarton: p.piecesPerCarton,
    volumeBeforePackingCbm: p.volumeBeforePackingCbm,
    volumeAfterPackingCbm: p.volumeAfterPackingCbm,
    buyers: p.buyers.map((b) => ({ buyerId: b.buyerId, buyerCode: b.buyerCode })),
    related: p.related.map((r) => ({ relatedId: r.relatedId, relation: r.relation, note: r.note })),
    costSheet: p.costSheet
      ? {
          currencyId: p.costSheet.currencyId,
          factoryExpensePct: p.costSheet.factoryExpensePct,
          marginPct: p.costSheet.marginPct,
          notes: p.costSheet.notes,
          groups: p.costSheet.groups.map((g) => ({
            head: g.head,
            name: g.name,
            method: g.method,
            dimUnit: g.dimUnit,
            sortOrder: g.sortOrder,
            notes: g.notes,
            lines: g.lines.map((l) => ({ ...l, id: undefined })),
          })),
        }
      : { currencyId: null, factoryExpensePct: 15, marginPct: 15, groups: [] },
  };
}
