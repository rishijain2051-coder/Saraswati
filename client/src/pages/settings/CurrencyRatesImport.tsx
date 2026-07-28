import { useMemo, useState } from 'react';
import { Alert, Button, Input, Modal, Space, Table, Typography, App, InputNumber } from 'antd';
import { ImportOutlined, LinkOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import { api, apiError } from '../../api/client';
import type { Currency } from '../../api/types';

const { Text, Paragraph, Link: AntLink } = Typography;

const ICEGATE_URL = 'https://foservices.icegate.gov.in/#/services/viewExchangeRate';

// Common ICEGATE currency names → ISO code (best-effort paste parsing).
const NAME_TO_CODE: Record<string, string> = {
  'US DOLLAR': 'USD', 'UNITED STATES DOLLAR': 'USD',
  EURO: 'EUR',
  'POUND STERLING': 'GBP', 'GREAT BRITAIN POUND': 'GBP', 'BRITISH POUND': 'GBP',
  'AUSTRALIAN DOLLAR': 'AUD', 'CANADIAN DOLLAR': 'CAD', 'SWISS FRANC': 'CHF',
  'JAPANESE YEN': 'JPY', 'CHINESE YUAN': 'CNY', 'SINGAPORE DOLLAR': 'SGD',
  'UAE DIRHAM': 'AED', 'HONG KONG DOLLAR': 'HKD', 'NEW ZEALAND DOLLAR': 'NZD',
  'SAUDI ARABIAN RIYAL': 'SAR', 'QATARI RIYAL': 'QAR', 'SOUTH AFRICAN RAND': 'ZAR',
  'DANISH KRONER': 'DKK', 'NORWEGIAN KRONER': 'NOK', 'SWEDISH KRONER': 'SEK',
  'KOREAN WON': 'KRW', 'KUWAITI DINAR': 'KWD', 'BAHRAINI DINAR': 'BHD', 'TURKISH LIRA': 'TRY',
};

/** Parse pasted ICEGATE text → { CODE: exportRate }. Export rate = last number on the line. */
function parseRates(text: string, ourCodes: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of text.split(/\r?\n/)) {
    const upper = line.toUpperCase();
    let code: string | undefined = ourCodes.find((c) => new RegExp(`\\b${c}\\b`).test(upper));
    if (!code) {
      const hit = Object.entries(NAME_TO_CODE).find(([name, cc]) => ourCodes.includes(cc) && upper.includes(name));
      code = hit?.[1];
    }
    if (!code) continue;
    const nums = (line.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter((n) => n > 0);
    if (nums.length) out[code] = nums[nums.length - 1]; // ICEGATE order: Import, then Export
  }
  return out;
}

export default function CurrencyRatesImport({ currencies }: { currencies: Currency[] }) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState('');
  const [rates, setRates] = useState<Record<string, number | null>>({});

  const targets = useMemo(() => currencies.filter((c) => !c.isBase), [currencies]);
  const ourCodes = useMemo(() => targets.map((c) => c.code), [targets]);

  const openModal = () => {
    setPaste('');
    setRates(Object.fromEntries(targets.map((c) => [c.code, c.rateToBase])));
    setOpen(true);
  };

  const doParse = () => {
    const parsed = parseRates(paste, ourCodes);
    if (!Object.keys(parsed).length) {
      message.warning('Could not find any known currency in the pasted text. You can still edit the rates below.');
      return;
    }
    setRates((r) => ({ ...r, ...parsed }));
    message.success(`Parsed ${Object.keys(parsed).length} rate(s). Please verify below.`);
  };

  const apply = useMutation({
    mutationFn: async () => {
      const payload = targets
        .map((c) => ({ code: c.code, rateToBase: rates[c.code] }))
        .filter((r): r is { code: string; rateToBase: number } => typeof r.rateToBase === 'number' && r.rateToBase > 0);
      return (await api.post<{ updated: number; unmatched: string[] }>('/currencies/bulk-rates', { rates: payload })).data;
    },
    onSuccess: (res) => {
      message.success(`Updated ${res.updated} currency rate(s).`);
      qc.invalidateQueries({ queryKey: ['currencies'] });
      setOpen(false);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const columns: ColumnsType<Currency> = [
    { title: 'Code', dataIndex: 'code', width: 80, render: (c) => <b>{c}</b> },
    { title: 'Currency', dataIndex: 'name' },
    {
      title: 'Export rate (₹ per unit)',
      key: 'rate',
      width: 200,
      render: (_, c) => (
        <InputNumber
          style={{ width: 160 }}
          step={0.01}
          value={rates[c.code] ?? undefined}
          onChange={(v) => setRates((r) => ({ ...r, [c.code]: v }))}
        />
      ),
    },
  ];

  return (
    <>
      <Button icon={<ImportOutlined />} onClick={openModal} style={{ marginBottom: 12, marginLeft: 8 }}>
        Import export rates (ICEGATE)
      </Button>

      <Modal
        title="Import export rates from ICEGATE"
        open={open}
        width={640}
        okText={`Apply to ${targets.length} currencies`}
        onOk={() => apply.mutate()}
        confirmLoading={apply.isPending}
        onCancel={() => setOpen(false)}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="ICEGATE requires a CAPTCHA, so rates can't be fetched automatically."
          description={
            <span>
              Open the official page, solve the CAPTCHA, pick the date, and copy the table. Paste it below —
              I'll read the <b>Export</b> rate column. You can also just type the rates in.
            </span>
          }
        />
        <AntLink href={ICEGATE_URL} target="_blank" rel="noreferrer">
          <LinkOutlined /> Open ICEGATE exchange-rate page
        </AntLink>

        <Paragraph style={{ marginTop: 12, marginBottom: 4 }}>
          <Text type="secondary">Paste copied rows here, then Parse:</Text>
        </Paragraph>
        <Input.TextArea rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="e.g.  US Dollar    85.20    84.10" />
        <Button onClick={doParse} style={{ margin: '8px 0' }}>
          Parse pasted text
        </Button>

        <Table<Currency> rowKey="code" size="small" columns={columns} dataSource={targets} pagination={false} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          Note: ICEGATE quotes some currencies per 100 units (e.g. Yen, Won) — divide by 100 before applying.
        </Text>
      </Modal>
    </>
  );
}
