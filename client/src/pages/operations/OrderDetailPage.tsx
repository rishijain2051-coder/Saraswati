import { Breadcrumb, Button, Card, Col, Descriptions, Progress, Row, Select, Skeleton, Space, Table, Tag, Typography, App, Result, Popconfirm } from 'antd';
import { HomeOutlined, EditOutlined, ArrowLeftOutlined, ProfileOutlined, EyeOutlined, ThunderboltOutlined, SplitCellsOutlined } from '@ant-design/icons';
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

  const refresh = () => { qc.invalidateQueries({ queryKey: ['order', id] }); qc.invalidateQueries({ queryKey: ['orders'] }); qc.invalidateQueries({ queryKey: ['op-sheets'] }); qc.invalidateQueries({ queryKey: ['ops-dashboard'] }); };
  const setStatus = useMutation({ mutationFn: (status: string) => api.patch(`/orders/${id}/status`, { status }), onSuccess: () => { message.success('Status updated.'); refresh(); }, onError: (e) => message.error(apiError(e)) });
  const makeSheet = useMutation({
    mutationFn: ({ line, split }: { line: OrderLineDto; split?: boolean }) => api.post('/operation-sheets', { productId: line.productId, orderId: Number(id), qty: split ? Math.max((line.pending ?? line.qty), 1) : line.qty, status: 'InProgress', split }),
    onSuccess: (res) => { navigate(`/operations/sheets/${(res.data as any).id}`); },
    onError: (e) => message.error(apiError(e)),
  });
  const generateAll = useMutation({
    mutationFn: () => api.post(`/orders/${id}/generate-sheets`, {}),
    onSuccess: (res) => { message.success(`Created ${(res.data as any).created} sheet(s).`); refresh(); },
    onError: (e) => message.error(apiError(e)),
  });

  if (isLoading) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (isError || !o) return <Result status="404" title="Order not found" extra={<Button onClick={() => navigate('/operations/orders')}>Back</Button>} />;

  const symbol = o.currency?.symbol ?? '₹';
  const sheetFor = (pid: number) => o.sheets?.find((s) => s.productId === pid);
  const pct = o.totalOrdered ? Math.round(((o.totalProduced ?? 0) / o.totalOrdered) * 100) : 0;

  const cols: ColumnsType<OrderLineDto> = [
    { title: 'Product', dataIndex: 'productId', render: (_, r) => <Link to={`/products/${r.product?.id}`}>{r.product?.factoryCode} — {r.product?.name}</Link> },
    { title: 'Ordered', dataIndex: 'qty', align: 'right', width: 80 },
    {
      title: 'Produced', key: 'prod', align: 'right', width: 150,
      render: (_, r) => <span><b>{r.produced ?? 0}</b> / {r.qty} {(r.pending ?? 0) > 0 ? <Tag color="orange" style={{ marginLeft: 6 }}>{r.pending} pending</Tag> : <Tag color="green" style={{ marginLeft: 6 }}>done</Tag>}</span>,
    },
    { title: 'Unit Price', dataIndex: 'unitPrice', align: 'right', render: (v) => money(v, symbol) },
    { title: 'Amount', key: 'amt', align: 'right', render: (_, r) => <b>{money(r.qty * r.unitPrice, symbol)}</b> },
    {
      title: 'Operation sheet', key: 'sheet', width: 230,
      render: (_, r) => {
        if (!hasRole('Operator')) return null;
        const s = sheetFor(r.productId);
        return s ? (
          <Space>
            <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/operations/sheets/${s.id}`)}>View {s.number}</Button>
            <Button size="small" icon={<SplitCellsOutlined />} title="Add another sheet (split qty)" loading={makeSheet.isPending} onClick={() => makeSheet.mutate({ line: r, split: true })} />
          </Space>
        ) : (
          <Button size="small" type="primary" ghost icon={<ProfileOutlined />} loading={makeSheet.isPending} onClick={() => makeSheet.mutate({ line: r })}>Create sheet</Button>
        );
      },
    },
  ];

  return (
    <div>
      <Breadcrumb style={{ marginBottom: 16 }} items={[{ title: <Link to="/"><HomeOutlined /></Link> }, { title: <Link to="/operations">Operations</Link> }, { title: <Link to="/operations/orders">Orders</Link> }, { title: o.number }]} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <Space><Title level={3} style={{ margin: 0 }}>{o.number}</Title><Tag color={ORDER_STATUS_COLOR[o.status] ?? 'default'}>{o.status}</Tag></Space>
        <Space wrap>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/operations/orders')}>Back</Button>
          {hasRole('Operator') && <Button icon={<ThunderboltOutlined />} loading={generateAll.isPending} onClick={() => generateAll.mutate()}>Generate all sheets</Button>}
          {hasRole('Operator') && <Select value={o.status} style={{ width: 150 }} onChange={(v) => setStatus.mutate(v)} options={ORDER_STATUSES.map((s) => ({ label: s, value: s }))} />}
          {hasRole('Operator') && <Button type="primary" icon={<EditOutlined />} onClick={() => navigate(`/operations/orders/${o.id}/edit`)}>Edit</Button>}
        </Space>
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Row align="middle" gutter={16}>
          <Col flex="auto">
            <Text type="secondary">Production progress — {o.totalProduced ?? 0} of {o.totalOrdered ?? 0} pcs made ({o.totalPending ?? 0} pending)</Text>
            <Progress percent={pct} status={pct >= 100 ? 'success' : 'active'} strokeColor="#6d4c41" />
          </Col>
        </Row>
      </Card>

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
          <Card size="small" title="Products & production">
            <Table<OrderLineDto> rowKey={(r) => String(r.id)} size="small" columns={cols} dataSource={o.lines} pagination={false} scroll={{ x: 800 }} />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title={`Operation sheets (${o.sheets?.length ?? 0})`}>
            {o.sheets && o.sheets.length ? (
              <Space direction="vertical" style={{ width: '100%' }}>
                {o.sheets.map((s) => (
                  <Button key={s.id} block style={{ textAlign: 'left', height: 'auto', padding: 8 }} onClick={() => navigate(`/operations/sheets/${s.id}`)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <span>{s.number} <Tag color={s.mode === 'OUTSOURCED' ? 'volcano' : 'blue'} style={{ marginLeft: 4 }}>{s.mode === 'OUTSOURCED' ? 'Jobwork' : 'In-house'}</Tag></span>
                      <span><Text type="secondary">{s.producedQty}/{s.qty}</Text> <Tag>{s.status}</Tag></span>
                    </div>
                  </Button>
                ))}
              </Space>
            ) : (
              <Text type="secondary">No sheets yet. Use "Generate all sheets" or "Create sheet" on a line.</Text>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
