import { useMemo, useState } from 'react';
import { App, Breadcrumb, Button, Card, Popconfirm, Progress, Segmented, Space, Table, Tag, Typography } from 'antd';
import { HomeOutlined, PlusOutlined, EyeOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { api, apiError } from '../../api/client';
import { useOrders, ORDER_STATUS_COLOR, type Order } from '../../api/ops';
import { useAuth } from '../../auth/AuthContext';
import { money } from '../../util/format';
import { MiniStrip } from './board/StageStrip';

const { Title, Text } = Typography;

/** Re-exported for pages that only need the colour map. */
export { ORDER_STATUS_COLOR };

const FILTERS = ['All', 'Live', 'Confirmed', 'Production', 'Ready', 'Shipped', 'Closed', 'Cancelled'] as const;

export default function OrdersPage() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { data, isLoading } = useOrders();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('Live');

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/orders/${id}`),
    onSuccess: () => {
      message.success('Order deleted.');
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['ops-dashboard'] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  const rows = useMemo(() => {
    const all = data ?? [];
    if (filter === 'All') return all;
    if (filter === 'Live') return all.filter((o) => !['Shipped', 'Closed', 'Cancelled'].includes(o.status));
    return all.filter((o) => o.status === filter);
  }, [data, filter]);

  const columns: ColumnsType<Order> = [
    { title: 'Order No.', dataIndex: 'number', width: 150, render: (n, r) => <Link to={`/operations/orders/${r.id}`} style={{ fontWeight: 600 }}>{n}</Link> },
    { title: 'Buyer', dataIndex: ['buyer', 'name'], width: 180 },
    { title: 'Delivery', dataIndex: 'deliveryDate', width: 110, render: (d) => (d ? dayjs(d).format('DD MMM YY') : '—') },
    {
      title: 'Production',
      key: 'prod',
      width: 300,
      render: (_, r) => (
        <div>
          <Space size={6}>
            <Progress percent={r.summary.progressPct} size="small" style={{ width: 90 }} strokeColor="#6d4c41" />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {r.summary.done}/{r.summary.ordered} pcs
            </Text>
          </Space>
          <div style={{ marginTop: 2 }}>{r.lines.length === 1 ? <MiniStrip board={r.lines[0].board} /> : <Text type="secondary" style={{ fontSize: 12 }}>{r.lines.length} products</Text>}</div>
        </div>
      ),
    },
    { title: 'Total', dataIndex: 'total', align: 'right', width: 130, render: (v, r) => money(v, r.currency?.symbol ?? '₹') },
    { title: 'Status', dataIndex: 'status', width: 110, render: (s) => <Tag color={ORDER_STATUS_COLOR[s] ?? 'default'}>{s}</Tag> },
    {
      title: '',
      key: 'a',
      width: 120,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/operations/orders/${r.id}`)} />
          {hasRole('Operator') && <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`/operations/orders/${r.id}/edit`)} />}
          {hasRole('Manager') && (
            <Popconfirm
              title="Delete this order?"
              description="Its production history, hand-over photos and money entries go with it."
              onConfirm={() => del.mutate(r.id)}
              okButtonProps={{ danger: true }}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Breadcrumb style={{ marginBottom: 16 }} items={[{ title: <Link to="/"><HomeOutlined /></Link> }, { title: <Link to="/operations">Operations</Link> }, { title: 'Orders' }]} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            Orders
          </Title>
          <Text type="secondary">Open one to see and move every piece through its stages.</Text>
        </div>
        {hasRole('Operator') && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/operations/orders/new')}>
            New Order
          </Button>
        )}
      </div>
      <Card size="small">
        <Segmented style={{ marginBottom: 12 }} value={filter} onChange={(v) => setFilter(v as (typeof FILTERS)[number])} options={FILTERS as unknown as string[]} />
        <Table<Order>
          rowKey="id"
          size="small"
          loading={isLoading}
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          scroll={{ x: 1000 }}
          locale={{ emptyText: filter === 'Live' ? 'No live orders. Accept a proforma to create one.' : 'No orders here.' }}
        />
      </Card>
    </div>
  );
}
