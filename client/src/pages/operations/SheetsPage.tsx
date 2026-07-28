import { useState } from 'react';
import { Breadcrumb, Button, Card, Form, InputNumber, Modal, Select, Space, Table, Tag, Typography, App, Popconfirm } from 'antd';
import { HomeOutlined, PlusOutlined, EyeOutlined, DeleteOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import { api, apiError } from '../../api/client';
import { useSheets, useOrders, type OperationSheet } from '../../api/ops';
import { useProducts } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';

const { Title } = Typography;

const SHEET_STATUS_COLOR: Record<string, string> = { Draft: 'default', InProgress: 'gold', Completed: 'green' };

export default function SheetsPage() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { data, isLoading } = useSheets();
  const { data: products } = useProducts({});
  const { data: orders } = useOrders();
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);

  const create = useMutation({
    mutationFn: (v: any) => api.post('/operation-sheets', { ...v, status: 'InProgress' }),
    onSuccess: (res) => { message.success('Operation sheet created.'); setOpen(false); form.resetFields(); qc.invalidateQueries({ queryKey: ['op-sheets'] }); navigate(`/operations/sheets/${(res.data as any).id}`); },
    onError: (e) => message.error(apiError(e)),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/operation-sheets/${id}`),
    onSuccess: () => { message.success('Deleted.'); qc.invalidateQueries({ queryKey: ['op-sheets'] }); },
    onError: (e) => message.error(apiError(e)),
  });

  const columns: ColumnsType<OperationSheet> = [
    { title: 'Sheet No.', dataIndex: 'number', render: (n, r) => <Link to={`/operations/sheets/${r.id}`} style={{ fontWeight: 600 }}>{n}</Link> },
    { title: 'Product', dataIndex: 'product', render: (p: OperationSheet['product']) => `${p.factoryCode} — ${p.name}` },
    { title: 'Order', dataIndex: 'order', render: (o: OperationSheet['order']) => (o ? <Link to={`/operations/orders/${o.id}`}>{o.number}</Link> : '—') },
    { title: 'Qty', dataIndex: 'qty', align: 'right' },
    { title: 'Stages', dataIndex: 'stages', render: (s: OperationSheet['stages']) => s.length },
    { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={SHEET_STATUS_COLOR[s] ?? 'default'}>{s}</Tag> },
    {
      title: 'Actions', key: 'a', width: 110,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/operations/sheets/${r.id}`)} />
          {hasRole('Manager') && <Popconfirm title="Delete sheet?" onConfirm={() => del.mutate(r.id)} okButtonProps={{ danger: true }}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm>}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Breadcrumb style={{ marginBottom: 16 }} items={[{ title: <Link to="/"><HomeOutlined /></Link> }, { title: <Link to="/operations">Operations</Link> }, { title: 'Operation Sheets' }]} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Operation Sheets</Title>
        {hasRole('Operator') && <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); form.setFieldsValue({ qty: 1 }); setOpen(true); }}>New Sheet</Button>}
      </div>
      <Card size="small"><Table<OperationSheet> rowKey="id" size="small" loading={isLoading} columns={columns} dataSource={data ?? []} pagination={{ pageSize: 20 }} scroll={{ x: 800 }} /></Card>

      <Modal title="New operation sheet" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={create.isPending} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)} style={{ marginTop: 12 }}>
          <Form.Item name="productId" label="Product" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={(products ?? []).map((p) => ({ label: `${p.factoryCode} — ${p.name}`, value: p.id }))} />
          </Form.Item>
          <Form.Item name="qty" label="Order quantity (pieces)" rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="orderId" label="Link to order (optional)">
            <Select allowClear showSearch optionFilterProp="label" options={(orders ?? []).map((o) => ({ label: `${o.number} — ${o.buyer.name}`, value: o.id }))} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
