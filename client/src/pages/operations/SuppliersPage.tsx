import { Breadcrumb, Typography } from 'antd';
import { HomeOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import MasterCrud, { type FieldDef } from '../../components/MasterCrud';

const { Title, Text } = Typography;

const fields: FieldDef[] = [
  { name: 'code', label: 'Code', type: 'text', required: true, width: 110 },
  { name: 'name', label: 'Name', type: 'text', required: true },
  {
    name: 'type', label: 'Type', type: 'select', required: true, defaultValue: 'MATERIAL', width: 120,
    options: [
      { label: 'Material', value: 'MATERIAL' },
      { label: 'Jobwork', value: 'JOBWORK' },
      { label: 'Both', value: 'BOTH' },
    ],
  },
  { name: 'contactName', label: 'Contact', type: 'text' },
  { name: 'phone', label: 'Phone', type: 'text' },
  { name: 'gstNo', label: 'GST No.', type: 'text' },
  { name: 'address', label: 'Address', type: 'text', hideInTable: true },
  { name: 'paymentTerms', label: 'Payment Terms', type: 'text', hideInTable: true },
  { name: 'isActive', label: 'Active', type: 'switch', defaultValue: true, width: 80 },
];

export default function SuppliersPage() {
  return (
    <div>
      <Breadcrumb style={{ marginBottom: 16 }} items={[{ title: <Link to="/"><HomeOutlined /></Link> }, { title: <Link to="/operations">Operations</Link> }, { title: 'Suppliers' }]} />
      <Title level={3} style={{ marginBottom: 2 }}>Suppliers</Title>
      <Text type="secondary">Material suppliers & jobwork vendors. Dues appear under Payments.</Text>
      <div style={{ marginTop: 16 }}>
        <MasterCrud endpoint="/suppliers" queryKey={['suppliers', 'all']} fields={fields} />
      </div>
    </div>
  );
}
