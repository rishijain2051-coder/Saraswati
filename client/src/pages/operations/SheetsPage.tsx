import { useMemo, useState } from 'react';
import { Breadcrumb, Button, Card, Collapse, Form, InputNumber, Modal, Select, Space, Table, Tag, Typography, App, Popconfirm, Progress } from 'antd';
import { HomeOutlined, PlusOutlined, EyeOutlined, DeleteOutlined, ShopOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import { api, apiError } from '../../api/client';
import { useSheets, useOrders, useSuppliers, type OperationSheet } from '../../api/ops';
import { useProducts } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';

const { Title, Text } = Typography;
const SHEET_STATUS_COLOR: Record<string, string> = { Draft: 'default', InProgress: 'gold', Completed: 'green' };

function SheetGroup({ title, orderId, sheets, vendors, onOutsourced }: { title: React.ReactNode; orderId?: number; sheets: OperationSheet[]; vendors: { id: number; name: string }[]; onOutsourced: () => void }) {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const { message } = App.useApp();
  const [sel, setSel] = useState<number[]>([]);
  const [vendorId, setVendorId] = useState<number>();

  const outsource = useMutation({
    mutationFn: () => api.post('/operation-sheets/bulk-outsource', { ids: sel, vendorId: vendorId ?? null }),
    onSuccess: (res) => { message.success(`Assigned ${(res.data as any).updated} sheet(s).`); setSel([]); onOutsourced(); },
    onError: (e) => message.error(apiError(e)),
  });

  const cols: ColumnsType<OperationSheet> = [
    { title: 'Sheet', dataIndex: 'number', render: (n, r) => <Link to={`/operations/sheets/${r.id}`} style={{ fontWeight: 600 }}>{n}</Link> },
    { title: 'Product', dataIndex: 'product', render: (p: OperationSheet['product']) => `${p.factoryCode} — ${p.name}` },
    { title: 'Mode', dataIndex: 'mode', width: 130, render: (m, r) => m === 'OUTSOURCED' ? <Tag color="volcano">Jobwork{r.vendor ? `: ${r.vendor.name}` : ''}</Tag> : <Tag color="blue">In-house</Tag> },
    { title: 'Made', key: 'made', width: 140, render: (_, r) => <span>{r.producedQty}/{r.qty} <Progress percent={r.qty ? Math.round((r.producedQty / r.qty) * 100) : 0} size="small" showInfo={false} style={{ width: 60, display: 'inline-block', marginLeft: 6 }} /></span> },
    { title: 'Status', dataIndex: 'status', width: 110, render: (s) => <Tag color={SHEET_STATUS_COLOR[s] ?? 'default'}>{s}</Tag> },
    { title: '', key: 'a', width: 50, render: (_, r) => <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/operations/sheets/${r.id}`)} /> },
  ];

  return (
    <Card size="small" style={{ marginBottom: 12 }} title={title}
      extra={hasRole('Operator') && sel.length > 0 && (
        <Space>
          <Select size="small" placeholder="Jobwork vendor" style={{ width: 180 }} value={vendorId} onChange={setVendorId} allowClear options={vendors.map((v) => ({ label: v.name, value: v.id }))} />
          <Button size="small" type="primary" icon={<ShopOutlined />} loading={outsource.isPending} onClick={() => outsource.mutate()}>Assign {sel.length} → {vendorId ? 'vendor' : 'in-house'}</Button>
        </Space>
      )}>
      <Table<OperationSheet> rowKey="id" size="small" columns={cols} dataSource={sheets} pagination={false} scroll={{ x: 700 }}
        rowSelection={hasRole('Operator') ? { selectedRowKeys: sel, onChange: (k) => setSel(k as number[]) } : undefined} />
    </Card>
  );
}

export default function SheetsPage() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { data, isLoading } = useSheets();
  const { data: products } = useProducts({});
  const { data: orders } = useOrders();
  const { data: vendors } = useSuppliers('JOBWORK');
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);

  const create = useMutation({
    mutationFn: (v: any) => api.post('/operation-sheets', { ...v, status: 'InProgress' }),
    onSuccess: (res) => { message.success('Created.'); setOpen(false); form.resetFields(); qc.invalidateQueries({ queryKey: ['op-sheets'] }); navigate(`/operations/sheets/${(res.data as any).id}`); },
    onError: (e) => message.error(apiError(e)),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['op-sheets'] });

  // Group by order.
  const groups = useMemo(() => {
    const map = new Map<string, { orderId?: number; orderNumber?: string; sheets: OperationSheet[] }>();
    for (const s of data ?? []) {
      const key = s.order ? String(s.order.id) : 'none';
      if (!map.has(key)) map.set(key, { orderId: s.order?.id, orderNumber: s.order?.number, sheets: [] });
      map.get(key)!.sheets.push(s);
    }
    return Array.from(map.values());
  }, [data]);

  return (
    <div>
      <Breadcrumb style={{ marginBottom: 16 }} items={[{ title: <Link to="/"><HomeOutlined /></Link> }, { title: <Link to="/operations">Operations</Link> }, { title: 'Operation Sheets' }]} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div><Title level={3} style={{ margin: 0 }}>Operation Sheets</Title><Text type="secondary">Grouped by order. Tick sheets to bulk-assign them to a jobwork vendor.</Text></div>
        {hasRole('Operator') && <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); form.setFieldsValue({ qty: 1 }); setOpen(true); }}>New Sheet</Button>}
      </div>

      {isLoading ? <Card loading /> : groups.length === 0 ? <Card><Text type="secondary">No operation sheets yet.</Text></Card> : groups.map((g, i) => {
        const made = g.sheets.reduce((a, s) => a + s.producedQty, 0);
        const planned = g.sheets.reduce((a, s) => a + s.qty, 0);
        return (
          <SheetGroup
            key={i}
            orderId={g.orderId}
            sheets={g.sheets}
            vendors={vendors ?? []}
            onOutsourced={refresh}
            title={
              <Space>
                {g.orderNumber ? <Link to={`/operations/orders/${g.orderId}`}>{g.orderNumber}</Link> : <Text type="secondary">Unlinked sheets</Text>}
                <Tag>{g.sheets.length} sheet(s)</Tag>
                <Text type="secondary">made {made}/{planned}</Text>
              </Space>
            }
          />
        );
      })}

      <Modal title="New operation sheet" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={create.isPending} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)} style={{ marginTop: 12 }}>
          <Form.Item name="productId" label="Product" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(products ?? []).map((p) => ({ label: `${p.factoryCode} — ${p.name}`, value: p.id }))} /></Form.Item>
          <Form.Item name="qty" label="Quantity (pieces)" rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="orderId" label="Link to order (optional)"><Select allowClear showSearch optionFilterProp="label" options={(orders ?? []).map((o) => ({ label: `${o.number} — ${o.buyer.name}`, value: o.id }))} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
