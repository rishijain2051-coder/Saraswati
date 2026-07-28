import { Breadcrumb, Button, Card, Space, Table, Tag, Typography, Popconfirm, App } from 'antd';
import { HomeOutlined, PlusOutlined, EyeOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { api, apiError } from '../../api/client';
import { useProformas, type Proforma } from '../../api/ops';
import { useAuth } from '../../auth/AuthContext';
import { money } from '../../util/format';

const { Title } = Typography;

export const PROFORMA_STATUS_COLOR: Record<string, string> = { Draft: 'default', Sent: 'blue', Accepted: 'green', Rejected: 'red' };

export default function ProformasPage() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { data, isLoading } = useProformas();

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/proformas/${id}`),
    onSuccess: () => { message.success('Proforma deleted.'); qc.invalidateQueries({ queryKey: ['proformas'] }); },
    onError: (e) => message.error(apiError(e)),
  });

  const columns: ColumnsType<Proforma> = [
    { title: 'PI No.', dataIndex: 'number', render: (n, r) => <Link to={`/operations/proformas/${r.id}`} style={{ fontWeight: 600 }}>{n}</Link> },
    { title: 'Buyer', dataIndex: ['buyer', 'name'] },
    { title: 'Date', dataIndex: 'date', render: (d) => dayjs(d).format('DD MMM YY') },
    { title: 'Total', dataIndex: 'total', align: 'right', render: (v, r) => money(v, r.currency?.symbol ?? '₹') },
    { title: 'Order', dataIndex: 'order', render: (o: Proforma['order']) => (o ? <Link to={`/operations/orders/${o.id}`}>{o.number}</Link> : '—') },
    { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={PROFORMA_STATUS_COLOR[s] ?? 'default'}>{s}</Tag> },
    {
      title: 'Actions', key: 'a', width: 130,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/operations/proformas/${r.id}`)} />
          {hasRole('Operator') && !r.order && <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`/operations/proformas/${r.id}/edit`)} />}
          {hasRole('Manager') && (
            <Popconfirm title="Delete proforma?" onConfirm={() => del.mutate(r.id)} okButtonProps={{ danger: true }}>
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Breadcrumb style={{ marginBottom: 16 }} items={[{ title: <Link to="/"><HomeOutlined /></Link> }, { title: <Link to="/operations">Operations</Link> }, { title: 'Proformas' }]} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Proformas</Title>
        {hasRole('Operator') && <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/operations/proformas/new')}>New Proforma</Button>}
      </div>
      <Card size="small">
        <Table<Proforma> rowKey="id" size="small" loading={isLoading} columns={columns} dataSource={data ?? []} pagination={{ pageSize: 20 }} scroll={{ x: 800 }} />
      </Card>
    </div>
  );
}
