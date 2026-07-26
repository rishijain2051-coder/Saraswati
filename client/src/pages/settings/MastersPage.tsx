import { useState } from 'react';
import { Breadcrumb, Card, Select, Space, Tabs, Typography, Result } from 'antd';
import { HomeOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import MasterCrud, { type FieldDef } from '../../components/MasterCrud';
import FormulasTab from './FormulasTab';
import CurrencyRatesImport from './CurrencyRatesImport';
import { useCurrencies, useMeta } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';

const { Title, Text } = Typography;

const currencyFields: FieldDef[] = [
  { name: 'code', label: 'Code', type: 'text', required: true, width: 90 },
  { name: 'name', label: 'Name', type: 'text', required: true },
  { name: 'symbol', label: 'Symbol', type: 'text', width: 90 },
  { name: 'rateToBase', label: 'Rate to Base (INR)', type: 'number', step: 0.01, defaultValue: 1, required: true },
  { name: 'isBase', label: 'Base', type: 'switch', width: 90 },
  { name: 'isActive', label: 'Active', type: 'switch', defaultValue: true, width: 90 },
];

const unitFields: FieldDef[] = [
  { name: 'code', label: 'Code', type: 'text', required: true, width: 100 },
  { name: 'name', label: 'Name', type: 'text', required: true },
  { name: 'sortOrder', label: 'Order', type: 'number', defaultValue: 0, width: 90 },
  { name: 'isActive', label: 'Active', type: 'switch', defaultValue: true, width: 90 },
];

const buyerFields: FieldDef[] = [
  { name: 'code', label: 'Code', type: 'text', required: true, width: 90 },
  { name: 'name', label: 'Name', type: 'text', required: true },
  { name: 'country', label: 'Country', type: 'text' },
  { name: 'contactName', label: 'Contact', type: 'text' },
  { name: 'email', label: 'Email', type: 'text' },
  { name: 'phone', label: 'Phone', type: 'text' },
  { name: 'isActive', label: 'Active', type: 'switch', defaultValue: true, width: 90 },
];

const attrFields: FieldDef[] = [
  { name: 'value', label: 'Value', type: 'text', required: true },
  { name: 'code', label: 'Code', type: 'text', width: 120 },
  { name: 'sortOrder', label: 'Order', type: 'number', defaultValue: 0, width: 90 },
  { name: 'isActive', label: 'Active', type: 'switch', defaultValue: true, width: 90 },
];

function CurrenciesTab() {
  const { data: currencies } = useCurrencies();
  return (
    <div>
      <CurrencyRatesImport currencies={currencies ?? []} />
      <MasterCrud endpoint="/currencies" queryKey={['currencies']} fields={currencyFields} />
    </div>
  );
}

function AttributesTab() {
  const { data: meta } = useMeta();
  const types = meta?.attributeTypes ?? [];
  const [type, setType] = useState<string>('PRODUCT_TYPE');
  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Text>Attribute:</Text>
        <Select style={{ width: 220 }} value={type} onChange={setType} options={types.map((t) => ({ label: t.label, value: t.type }))} />
      </Space>
      <MasterCrud
        endpoint="/attributes"
        queryKey={['attributes', type]}
        fields={attrFields}
        fixed={{ type }}
        listParams={{ type }}
      />
    </div>
  );
}

export default function MastersPage() {
  const { hasRole } = useAuth();
  if (!hasRole('Manager')) {
    return <Result status="403" title="Restricted" subTitle="Master data is editable by Managers and Admins only." />;
  }

  return (
    <div>
      <Breadcrumb style={{ marginBottom: 16 }} items={[{ title: <Link to="/"><HomeOutlined /></Link> }, { title: 'Master Data' }]} />
      <Title level={3}>Master Data</Title>
      <Text type="secondary">These lists power the dropdowns, filters and costing across Product Management.</Text>
      <Card style={{ marginTop: 16 }}>
        <Tabs
          items={[
            { key: 'currencies', label: 'Currencies', children: <CurrenciesTab /> },
            { key: 'units', label: 'Units', children: <MasterCrud endpoint="/units" queryKey={['units']} fields={unitFields} /> },
            { key: 'buyers', label: 'Buyers', children: <MasterCrud endpoint="/buyers" queryKey={['buyers']} fields={buyerFields} /> },
            { key: 'attributes', label: 'Attributes', children: <AttributesTab /> },
            { key: 'formulas', label: 'Cost Formulas', children: <FormulasTab /> },
          ]}
        />
      </Card>
    </div>
  );
}
