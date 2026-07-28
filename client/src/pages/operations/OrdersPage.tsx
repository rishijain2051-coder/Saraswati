import { Breadcrumb, Button, Card, Space, Table, Tag, Typography, Popconfirm, App } from 'antd';
import { HomeOutlined, PlusOutlined, EyeOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { api, apiError } from '../../api/client';
import { useOrders, type Order } from '../../api/ops';
import { useAuth } from '../../auth/AuthContext';
import { money } from '../../util/format';

const { Title } = Typography;

export const ORDER_STATUS_COLOR: Record<string, string> = {
  Confirmed: 'blue', Production: 'gold', Ready: 'cyan', Shipped: 'green', Closed: 'default', Cancelled: 'red',
};

export default function OrdersPage() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { data, isLoading } = useOrders();

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/orders/${id}`),
    onSuccess: () => { message.success('Order deleted.'); qc.invalidateQueries({ queryKey: ['orders'] }); },
    onError: (e) => message.error(apiError(e)),
  });

  const columns: ColumnsType<Order> = [
    { title: 'Order No.', dataIndex: 'number', render: (n, r) => <Link to={`/operations/orders/${r.id}`} style={{ fontWeight: 600 }}>{n}</Link> },
    { title: 'Buyer', dataIndex: ['buyer', 'name'] },
    { title: 'Date', dataIndex: 'orderDate', render: (d) => dayjs(d).format('DD MMM YY') },
    { title: 'Delivery', dataIndex: 'deliveryDate', render: (d) => (d ? dayjs(d).format('DD MMM YY') : '—') },
    { title: 'Items', dataIndex: 'lines', render: (l: Order['lines']) => l.length },
    { title: 'Total', dataIndex: 'total', align: 'right', render: (v, r) => money(v, r.currency?.symbol ?? '₹') },
    { title: 'Sheets', dataIndex: 'sheets', render: (s: Order['sheets']) => (s?.length ? s.length : '—') },
    { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={ORDER_STATUS_COLOR[s] ?? 'default'}>{s}</Tag> },
    {
      title: 'Actions', key: 'a', width: 130,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/operations/orders/${r.id}`)} />
          {hasRole('Operator') && <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`/operations/orders/${r.id}/edit`)} />}
          {hasRole('Manager') && (
            <Popconfirm title="Delete order?" onConfirm={() => del.mutate(r.id)} okButtonProps={{ danger: true }}>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Orders</Title>
        {hasRole('Operator') && <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/operations/orders/new')}>New Order</Button>}
      </div>
      <Card size="small">
        <Table<Order> rowKey="id" size="small" loading={isLoading} columns={columns} dataSource={data ?? []} pagination={{ pageSize: 20 }} scroll={{ x: 900 }} />
      </Card>
    </div>
  );
}
