import { useState } from 'react';
import { Breadcrumb, Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Row, Select, Table, Tag, Typography, App, Popconfirm } from 'antd';
import { HomeOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import { api, apiError } from '../../api/client';
import { usePayments, useParties, useSuppliers, PARTY_TYPES, type LedgerEntry, type PartyDue } from '../../api/ops';
import { useBuyers } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { money } from '../../util/format';

const { Title, Text } = Typography;
const PARTY_COLOR: Record<string, string> = { SUPPLIER: 'brown', JOBWORK: 'volcano', BUYER: 'green', WORKER: 'blue' };

export default function PaymentsPage() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { hasRole } = useAuth();
  const { data: parties } = useParties();
  const { data: entries, isLoading } = usePayments();
  const { data: suppliers } = useSuppliers();
  const { data: buyers } = useBuyers();
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [ptype, setPtype] = useState('SUPPLIER');

  const refresh = () => { qc.invalidateQueries({ queryKey: ['payments'] }); qc.invalidateQueries({ queryKey: ['parties'] }); qc.invalidateQueries({ queryKey: ['ops-dashboard'] }); };
  const save = useMutation({
    mutationFn: (v: any) => {
      const supplierId = ['SUPPLIER', 'JOBWORK'].includes(v.partyType) ? v.partyRef : null;
      const buyerId = v.partyType === 'BUYER' ? v.partyRef : null;
      let partyName = v.partyName;
      if (supplierId) partyName = suppliers?.find((s) => s.id === supplierId)?.name ?? partyName;
      if (buyerId) partyName = buyers?.find((b) => b.id === buyerId)?.name ?? partyName;
      return api.post('/payments', { partyType: v.partyType, supplierId, buyerId, partyName, kind: v.kind, amount: v.amount, ref: v.ref || null, note: v.note || null, date: v.date ? v.date.toISOString() : undefined });
    },
    onSuccess: () => { message.success('Recorded.'); setOpen(false); form.resetFields(); refresh(); },
    onError: (e) => message.error(apiError(e)),
  });
  const del = useMutation({ mutationFn: (id: number) => api.delete(`/payments/${id}`), onSuccess: () => { message.success('Deleted.'); refresh(); }, onError: (e) => message.error(apiError(e)) });

  const partyCols: ColumnsType<PartyDue> = [
    { title: 'Type', dataIndex: 'partyType', width: 110, render: (t) => <Tag color={PARTY_COLOR[t]}>{t}</Tag> },
    { title: 'Party', dataIndex: 'partyName' },
    { title: 'Billed', dataIndex: 'billed', align: 'right', render: (v) => money(v, '₹') },
    { title: 'Paid', dataIndex: 'paid', align: 'right', render: (v) => money(v, '₹') },
    { title: 'Balance', dataIndex: 'balance', align: 'right', render: (v, r) => <b style={{ color: v > 0 ? (r.partyType === 'BUYER' ? '#389e0d' : '#cf1322') : '#999' }}>{money(v, '₹')}</b> },
    { title: '', dataIndex: 'partyType', key: 'lbl', width: 110, render: (t) => <Text type="secondary">{t === 'BUYER' ? 'receivable' : 'payable'}</Text> },
  ];

  const cols: ColumnsType<LedgerEntry> = [
    { title: 'Date', dataIndex: 'date', width: 100, render: (d) => dayjs(d).format('DD MMM YY') },
    { title: 'Type', dataIndex: 'partyType', width: 100, render: (t) => <Tag color={PARTY_COLOR[t]}>{t}</Tag> },
    { title: 'Party', dataIndex: 'partyName' },
    { title: 'Kind', dataIndex: 'kind', width: 90, render: (k) => <Tag color={k === 'BILL' ? 'orange' : 'green'}>{k}</Tag> },
    { title: 'Amount', dataIndex: 'amount', align: 'right', render: (v) => money(v, '₹') },
    { title: 'Ref', dataIndex: 'ref', render: (v) => v || '—' },
    { title: 'Note', dataIndex: 'note', render: (v) => v || '—' },
    ...(hasRole('Manager') ? [{ title: '', key: 'x', width: 40, render: (_: any, r: LedgerEntry) => <Popconfirm title="Delete entry?" onConfirm={() => del.mutate(r.id)}><Button size="small" danger type="text" icon={<DeleteOutlined />} /></Popconfirm> }] : []),
  ];

  const partyOptions = ['SUPPLIER', 'JOBWORK'].includes(ptype)
    ? (suppliers ?? []).map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))
    : ptype === 'BUYER'
    ? (buyers ?? []).map((b) => ({ label: `${b.code} · ${b.name}`, value: b.id }))
    : [];

  return (
    <div>
      <Breadcrumb style={{ marginBottom: 16 }} items={[{ title: <Link to="/"><HomeOutlined /></Link> }, { title: <Link to="/operations">Operations</Link> }, { title: 'Payments' }]} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div><Title level={3} style={{ margin: 0 }}>Payments</Title><Text type="secondary">Ledgers & running dues for suppliers, jobwork vendors, buyers and workers.</Text></div>
        {hasRole('Manager') && <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); form.setFieldsValue({ partyType: 'SUPPLIER', kind: 'BILL', date: dayjs() }); setPtype('SUPPLIER'); setOpen(true); }}>Add entry</Button>}
      </div>

      <Card size="small" title="Outstanding by party" style={{ marginBottom: 16 }}>
        <Table<PartyDue> rowKey={(r) => `${r.partyType}:${r.supplierId ?? r.buyerId ?? r.partyName}`} size="small" columns={partyCols} dataSource={parties ?? []} pagination={false} />
      </Card>

      <Card size="small" title="Ledger">
        <Table<LedgerEntry> rowKey="id" size="small" loading={isLoading} columns={cols} dataSource={entries ?? []} pagination={{ pageSize: 15 }} scroll={{ x: 800 }} />
      </Card>

      <Modal title="Record ledger entry" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={save.isPending} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)} style={{ marginTop: 12 }}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="partyType" label="Party type" rules={[{ required: true }]}><Select onChange={(v) => { setPtype(v); form.setFieldsValue({ partyRef: undefined }); }} options={PARTY_TYPES.map((t) => ({ label: t, value: t }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="kind" label="Kind" rules={[{ required: true }]}><Select options={[{ label: 'Bill (they/we owe)', value: 'BILL' }, { label: 'Payment / receipt', value: 'PAYMENT' }]} /></Form.Item></Col>
          </Row>
          {ptype === 'WORKER' ? (
            <Form.Item name="partyName" label="Worker name" rules={[{ required: true }]}><Input placeholder="Worker name" /></Form.Item>
          ) : (
            <Form.Item name="partyRef" label="Party" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={partyOptions} /></Form.Item>
          )}
          <Row gutter={12}>
            <Col span={12}><Form.Item name="amount" label="Amount (₹)" rules={[{ required: true }]}><InputNumber min={0.01} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="date" label="Date"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
          <Form.Item name="ref" label="Reference"><Input placeholder="e.g. bill no / ORD-2026-0001" /></Form.Item>
          <Form.Item name="note" label="Note"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
