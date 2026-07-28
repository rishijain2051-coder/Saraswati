import { Breadcrumb, Button, Card, Col, Descriptions, Row, Select, Skeleton, Space, Table, Tag, Typography, App, Result } from 'antd';
import { HomeOutlined, EditOutlined, ArrowLeftOutlined, ProfileOutlined } from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import { api, apiError } from '../../api/client';
import { useOrder, ORDER_STATUSES, type OrderLineDto } from '../../api/ops';
import { useAuth } from '../../auth/AuthContext';
import { money } from '../../util/format';
import { ORDER_STATUS_COLOR } from './OrdersPage';

const { Title, Text } = Typography;

export default function OrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { hasRole } = useAuth();
  const { data: o, isLoading, isError } = useOrder(id);

  const setStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/orders/${id}/status`, { status }),
    onSuccess: () => { message.success('Status updated.'); qc.invalidateQueries({ queryKey: ['order', id] }); qc.invalidateQueries({ queryKey: ['orders'] }); qc.invalidateQueries({ queryKey: ['ops-dashboard'] }); },
    onError: (e) => message.error(apiError(e)),
  });

  const makeSheet = useMutation({
    mutationFn: (line: OrderLineDto) => api.post('/operation-sheets', { productId: line.productId, orderId: Number(id), qty: line.qty, status: 'InProgress' }),
    onSuccess: (res) => { message.success('Operation sheet created.'); navigate(`/operations/sheets/${(res.data as any).id}`); },
    onError: (e) => message.error(apiError(e)),
  });

  if (isLoading) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (isError || !o) return <Result status="404" title="Order not found" extra={<Button onClick={() => navigate('/operations/orders')}>Back</Button>} />;

  const symbol = o.currency?.symbol ?? '₹';
  const cols: ColumnsType<OrderLineDto> = [
    { title: 'Product', dataIndex: 'productId', render: (_, r) => <Link to={`/products/${r.product?.id}`}>{r.product?.factoryCode} — {r.product?.name}</Link> },
    { title: 'Qty', dataIndex: 'qty', align: 'right' },
    { title: 'Unit Price', dataIndex: 'unitPrice', align: 'right', render: (v) => money(v, symbol) },
    { title: 'Amount', key: 'amt', align: 'right', render: (_, r) => <b>{money(r.qty * r.unitPrice, symbol)}</b> },
    {
      title: '', key: 'sheet', width: 160,
      render: (_, r) => hasRole('Operator') && (
        <Button size="small" icon={<ProfileOutlined />} loading={makeSheet.isPending} onClick={() => makeSheet.mutate(r)}>Operation sheet</Button>
      ),
    },
  ];

  return (
    <div>
      <Breadcrumb style={{ marginBottom: 16 }} items={[{ title: <Link to="/"><HomeOutlined /></Link> }, { title: <Link to="/operations">Operations</Link> }, { title: <Link to="/operations/orders">Orders</Link> }, { title: o.number }]} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space><Title level={3} style={{ margin: 0 }}>{o.number}</Title><Tag color={ORDER_STATUS_COLOR[o.status] ?? 'default'}>{o.status}</Tag></Space>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/operations/orders')}>Back</Button>
          {hasRole('Operator') && (
            <Select value={o.status} style={{ width: 150 }} onChange={(v) => setStatus.mutate(v)} options={ORDER_STATUSES.map((s) => ({ label: s, value: s }))} />
          )}
          {hasRole('Operator') && <Button type="primary" icon={<EditOutlined />} onClick={() => navigate(`/operations/orders/${o.id}/edit`)}>Edit</Button>}
        </Space>
      </div>

      <Row gutter={16}>
        <Col xs={24} lg={16}>
          <Card size="small" title="Order" style={{ marginBottom: 16 }}>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="Buyer">{o.buyer.name}</Descriptions.Item>
              <Descriptions.Item label="Currency">{o.currency?.code ?? 'INR'}</Descriptions.Item>
              <Descriptions.Item label="Order date">{dayjs(o.orderDate).format('DD MMM YYYY')}</Descriptions.Item>
              <Descriptions.Item label="Delivery">{o.deliveryDate ? dayjs(o.deliveryDate).format('DD MMM YYYY') : '—'}</Descriptions.Item>
              <Descriptions.Item label="Incoterms">{o.incoterms || '—'}</Descriptions.Item>
              <Descriptions.Item label="From proforma">{o.proforma ? <Link to={`/operations/proformas/${o.proforma.id}`}>{o.proforma.number}</Link> : '—'}</Descriptions.Item>
              <Descriptions.Item label="Notes" span={2}>{o.notes || '—'}</Descriptions.Item>
            </Descriptions>
          </Card>
          <Card size="small" title="Products">
            <Table<OrderLineDto> rowKey={(r) => String(r.id)} size="small" columns={cols} dataSource={o.lines} pagination={false}
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={3} align="right"><b>Total</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right"><b>{money(o.total, symbol)}</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={2} />
                </Table.Summary.Row>
              )} />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title="Operation sheets">
            {o.sheets && o.sheets.length ? (
              <Space direction="vertical" style={{ width: '100%' }}>
                {o.sheets.map((s) => (
                  <Button key={s.id} block style={{ textAlign: 'left' }} onClick={() => navigate(`/operations/sheets/${s.id}`)}>
                    {s.number} <Tag style={{ marginLeft: 8 }}>{s.status}</Tag>
                  </Button>
                ))}
              </Space>
            ) : (
              <Text type="secondary">No operation sheets yet. Use "Operation sheet" on a product line to create one.</Text>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
