import { Breadcrumb, Card, Table, Tag, Typography, Statistic, Row, Col } from 'antd';
import { HomeOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import { api } from '../../api/client';
import { statusColor } from '../../util/format';
import ProductThumb from '../../components/ProductThumb';
import type { ProductSummary } from '../../api/types';

const { Title, Text } = Typography;

export default function ProductCataloguePage() {
  const { data, isLoading } = useQuery({
    queryKey: ['catalogue'],
    queryFn: async () => (await api.get<ProductSummary[]>('/products/catalogue')).data,
  });

  const rows = data ?? [];
  const active = rows.filter((r) => r.status === 'Active').length;
  const types = new Set(rows.map((r) => r.productType).filter(Boolean)).size;

  const columns: ColumnsType<ProductSummary> = [
    { title: '', dataIndex: 'primaryImage', width: 64, render: (u) => <ProductThumb url={u} size={48} /> },
    {
      title: 'Factory Code',
      dataIndex: 'factoryCode',
      render: (c, r) => <Link to={`/products/${r.id}`} style={{ fontWeight: 600 }}>{c}</Link>,
      sorter: (a, b) => a.factoryCode.localeCompare(b.factoryCode),
    },
    {
      title: 'Product',
      dataIndex: 'name',
      render: (name, r) => (
        <div>
          <div>{name}</div>
          {r.alias && <Text type="secondary" style={{ fontSize: 12 }}>{r.alias}</Text>}
        </div>
      ),
    },
    { title: 'Type', dataIndex: 'productType', render: (v) => v || '—' },
    { title: 'Size', dataIndex: 'size', render: (v) => v || '—' },
    { title: 'Colour', dataIndex: 'colour', render: (v) => v || '—' },
    { title: 'Material', dataIndex: 'material', render: (v) => v || '—' },
    {
      title: 'Buyer',
      dataIndex: 'buyers',
      render: (bs: ProductSummary['buyers']) => (bs[0] ? `${bs[0].code}${bs[0].buyerCode ? ` · ${bs[0].buyerCode}` : ''}` : '—'),
    },
    { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={statusColor(s)}>{s}</Tag> },
  ];

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          { title: <Link to="/"><HomeOutlined /></Link> },
          { title: <Link to="/products">Product Management</Link> },
          { title: 'Product Catalogue' },
        ]}
      />
      <Title level={3}>Product Catalogue</Title>
      <Text type="secondary">A visual, at-a-glance list of every product. Open any product for full details and costing.</Text>

      <Row gutter={16} style={{ margin: '16px 0' }}>
        <Col xs={8}><Card size="small"><Statistic title="Products" value={rows.length} /></Card></Col>
        <Col xs={8}><Card size="small"><Statistic title="Active" value={active} /></Card></Col>
        <Col xs={8}><Card size="small"><Statistic title="Product Types" value={types} /></Card></Col>
      </Row>

      <Table<ProductSummary>
        rowKey="id"
        size="small"
        loading={isLoading}
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 25, showTotal: (t) => `${t} products` }}
        scroll={{ x: 900 }}
      />
    </div>
  );
}
