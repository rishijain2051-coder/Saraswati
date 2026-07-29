import { Button, Checkbox, Input, InputNumber, Select, Space, Table, Tooltip, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { DocCharge } from '../api/ops';
import { chargeValue } from '../util/pricing';
import { money } from '../util/format';

const { Text } = Typography;

/** Names people actually type, offered so freight is not spelled four ways. */
const COMMON = ['Freight', 'Transport', 'Packing', 'Loading', 'Installation', 'Dealer discount', 'Festive discount', 'Round off'];

/**
 * Extra costs and discounts that belong to the whole document rather than one product.
 *
 * Each row carries its OWN GST rate instead of being apportioned across the lines —
 * that is how a real invoice bills freight, and apportioning would make the tax on one
 * product depend on unrelated ones. A percentage is always of the line subtotal, so the
 * order rows were entered in cannot change the total.
 */
export default function ChargesEditor({
  charges,
  subtotal,
  symbol,
  taxed,
  defaultGstPct,
  onChange,
}: {
  charges: DocCharge[];
  subtotal: number;
  symbol: string;
  /** Domestic documents show the GST column; an export is zero-rated. */
  taxed: boolean;
  defaultGstPct: number;
  onChange: (next: DocCharge[]) => void;
}) {
  const set = (i: number, patch: Partial<DocCharge>) => onChange(charges.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const add = () =>
    onChange([...charges, { name: '', kind: 'CHARGE', amount: 0, pct: 0, gstRatePct: taxed ? defaultGstPct : 0, isTaxable: true }]);

  const cols = [
    {
      title: 'What',
      dataIndex: 'name',
      render: (v: string, _r: DocCharge, i: number) => (
        <Select
          size="small"
          style={{ width: '100%', minWidth: 150 }}
          placeholder="Freight…"
          value={v || undefined}
          showSearch
          allowClear
          // Free text as well as the common list: every factory names these differently.
          mode="tags"
          maxCount={1}
          options={COMMON.map((x) => ({ value: x, label: x }))}
          onChange={(vals) => set(i, { name: (Array.isArray(vals) ? vals[vals.length - 1] : vals) ?? '' })}
        />
      ),
    },
    {
      title: 'Adds or takes off',
      dataIndex: 'kind',
      width: 130,
      render: (v: string, _r: DocCharge, i: number) => (
        <Select
          size="small"
          style={{ width: 120 }}
          value={v}
          onChange={(k) => set(i, { kind: k })}
          options={[
            { value: 'CHARGE', label: 'Charge +' },
            { value: 'DISCOUNT', label: 'Discount −' },
          ]}
        />
      ),
    },
    {
      title: `Amount (${symbol})`,
      dataIndex: 'amount',
      width: 120,
      render: (v: number, _r: DocCharge, i: number) => <InputNumber size="small" min={0} style={{ width: 110 }} value={v} onChange={(x) => set(i, { amount: x ?? 0 })} />,
    },
    {
      title: 'or % of items',
      dataIndex: 'pct',
      width: 110,
      render: (v: number, _r: DocCharge, i: number) => (
        <Tooltip title="A percentage of the line subtotal. Charges never compound, so the order they are listed in cannot change the total.">
          <InputNumber size="small" min={0} max={100} style={{ width: 100 }} value={v} onChange={(x) => set(i, { pct: x ?? 0 })} addonAfter="%" />
        </Tooltip>
      ),
    },
    ...(taxed
      ? [
          {
            title: 'GST',
            dataIndex: 'gstRatePct',
            width: 96,
            render: (v: number, r: DocCharge, i: number) => (
              <InputNumber size="small" min={0} max={100} style={{ width: 86 }} value={v} disabled={!r.isTaxable} onChange={(x) => set(i, { gstRatePct: x ?? 0 })} addonAfter="%" />
            ),
          },
          {
            title: 'Taxable',
            dataIndex: 'isTaxable',
            width: 82,
            render: (v: boolean, _r: DocCharge, i: number) => (
              <Tooltip title="Untick for something added after tax, such as a round-off.">
                <Checkbox checked={v} onChange={(e) => set(i, { isTaxable: e.target.checked, ...(e.target.checked ? {} : { gstRatePct: 0 }) })} />
              </Tooltip>
            ),
          },
        ]
      : []),
    {
      title: 'Effect',
      key: 'effect',
      width: 120,
      align: 'right' as const,
      render: (_: unknown, r: DocCharge) => {
        const v = chargeValue(r, subtotal);
        return (
          <Text type={v < 0 ? 'danger' : undefined} style={{ whiteSpace: 'nowrap' }}>
            {money(v, symbol)}
          </Text>
        );
      },
    },
    {
      title: '',
      key: 'x',
      width: 44,
      render: (_: unknown, _r: DocCharge, i: number) => <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={() => onChange(charges.filter((_, j) => j !== i))} />,
    },
  ];

  return (
    <Space direction="vertical" size={6} style={{ width: '100%' }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        Costs and discounts for the whole document — freight, packing, a dealer discount. Each one is taxed at its own rate rather than spread across the products.
      </Text>
      {charges.length > 0 && <Table<DocCharge> rowKey={(_, i) => String(i)} size="small" columns={cols as any} dataSource={charges} pagination={false} />}
      <Button size="small" icon={<PlusOutlined />} onClick={add}>
        Add a charge or discount
      </Button>
    </Space>
  );
}
