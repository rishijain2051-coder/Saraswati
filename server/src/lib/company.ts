/**
 * Exporter profile printed on proformas, challans and e-mail signatures.
 * Override any line from `.env` without touching code.
 */
export const company = {
  name: process.env.COMPANY_NAME || 'Saraswati Export',
  tagline: process.env.COMPANY_TAGLINE || 'Furniture & Hardware Exporter',
  address: process.env.COMPANY_ADDRESS || 'Jodhpur, Rajasthan, India',
  gstNo: process.env.COMPANY_GST || '',
  iecNo: process.env.COMPANY_IEC || '',
  email: process.env.COMPANY_EMAIL || '',
  phone: process.env.COMPANY_PHONE || '',
  website: process.env.COMPANY_WEBSITE || '',
};

/** Multi-line block used under the company name on documents. */
export function companyLines(): string[] {
  return [company.tagline, company.address, company.gstNo && `GSTIN: ${company.gstNo}`, company.iecNo && `IEC: ${company.iecNo}`, [company.phone, company.email].filter(Boolean).join('  ·  ')].filter(
    Boolean
  ) as string[];
}
