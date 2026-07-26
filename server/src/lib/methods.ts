import { prisma } from '../db';
import { methodDims, type MethodDef, type MethodMap } from './costing';

export function rowToMethodDef(r: {
  code: string;
  label: string;
  measureUnit: string;
  expression: string;
  usesL: boolean;
  usesW: boolean;
  usesH: boolean;
  usesWeight: boolean;
  usesWastage: boolean;
  dimUnit: string | null;
}): MethodDef {
  return {
    code: r.code,
    label: r.label,
    measureUnit: r.measureUnit,
    expression: r.expression,
    usesL: r.usesL,
    usesW: r.usesW,
    usesH: r.usesH,
    usesWeight: r.usesWeight,
    usesWastage: r.usesWastage,
    dimUnit: r.dimUnit,
  };
}

/** Load all cost methods as a code → definition map (for the costing engine). */
export async function loadMethodMap(): Promise<MethodMap> {
  const rows = await prisma.costMethod.findMany();
  const map: MethodMap = {};
  for (const r of rows) map[r.code] = rowToMethodDef(r);
  return map;
}

/** Shape sent to the frontend (adds derived `dims` + `hint`). */
export function methodToApi(m: MethodDef) {
  return {
    code: m.code,
    label: m.label,
    measureUnit: m.measureUnit,
    expression: m.expression,
    dims: methodDims(m),
    usesWeight: m.usesWeight,
    usesWastage: m.usesWastage,
    dimUnit: m.dimUnit,
    hint: m.expression,
  };
}
