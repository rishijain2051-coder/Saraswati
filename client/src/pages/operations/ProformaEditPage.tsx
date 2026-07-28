import { useEffect, useState } from 'react';
import { Breadcrumb, Button, Card, Col, DatePicker, Input, InputNumber, Row, Select, Space, Table, Typography, App } from 'antd';
import { HomeOutlined, PlusOutlined, DeleteOutlined, ThunderboltOutlined, SaveOutlined } from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import { api, apiError } from '../../api/client';
import { useBuyers, useCurrencies, useProducts } from '../../api/hooks';
import { useProforma, suggestPrice, type ProformaLineDto } from '../../api/ops';
import { money } from '../../util/format';

const { Title, Text } = Typography;

export default function ProformaEditPage() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();

  const { data: buyers } = useBuyers();
  const { data: currencies } = useCurrencies();
  const { data: products } = useProducts({});
  const { data: pf } = useProforma(editing ? id : undefined);

  const [f, setF] = useState<any>({ status: 'Draft', date: dayjs(), bankDetails: 'Bank: State Bank of India\nA/C: 000000000000\nIFSC: SBIN0000000\nSWIFT: SBININBB000' });
  const [lines, setLines] = useState<ProformaLineDto[]>([]);

  useEffect(() => {
    if (editing && pf) {
      setF({
        buyerId: pf.buyerId, currencyId: pf.currencyId ?? undefined, status: pf.status,
        date: dayjs(pf.date), validUntil: pf.validUntil ? dayjs(pf.validUntil) : null,
        paymentTerms: pf.paymentTerms ?? '', deliveryTerms: pf.deliveryTerms ?? '', incoterms: pf.incoterms ?? '',
        bankDetails: pf.bankDetails ?? '', notes: pf.notes ?? '',
      });
      setLines(pf.lines.map((l) => ({ productId: l.productId ?? null, description: l.description, qty: l.qty, unitPrice: l.unitPrice })));
    } else if (!editing && currencies && f.currencyId === undefined) {
      const nonBase = currencies.find((c) => !c.isBase) ?? currencies[0];
      setF((s: any) => ({ ...s, currencyId: nonBase?.id }));
    }
  }, [editing, pf, currencies]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: any) => setF((s: any) => ({ ...s, ...patch }));
  const symbol = currencies?.find((c) => c.id === f.currencyId)?.symbol ?? '₹';
  const total = lines.reduce((s, l) => s + (l.qty || 0) * (l.unitPrice || 0), 0);

  const setLine = (i: number, patch: Partial<ProformaLineDto>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { productId: null, description: '', qty: 1, unitPrice: 0 }]);
  const pickProduct = async (i: number, productId: number) => {
    const p = products?.find((x) => x.id === productId);
    setLine(i, { productId, description: p ? `${p.name}` : '' });
    try { const r = await suggestPrice(productId, f.currencyId); setLine(i, { unitPrice: r.suggested }); } catch (e) { message.error(apiError(e)); }
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        buyerId: f.buyerId, currencyId: f.currencyId, status: f.status,
        date: f.date?.toISOString(), validUntil: f.validUntil ? f.validUntil.toISOString() : null,
        paymentTerms: f.paymentTerms || null, deliveryTerms: f.deliveryTerms || null, incoterms: f.incoterms || null,
        bankDetails: f.bankDetails || null, notes: f.notes || null,
        lines: lines.filter((l) => l.description.trim()).map((l) => ({ productId: l.productId ?? null, description: l.description, qty: l.qty, unitPrice: l.unitPrice })),
      };
      return editing ? api.put(`/proformas/${id}`, body) : api.post('/proformas', body);
    },
    onSuccess: (res) => { message.success('Saved.'); qc.invalidateQueries({ queryKey: ['proformas'] }); navigate(`/operations/proformas/${(res.data as any).id}`); },
    onError: (e) => message.error(apiError(e)),
  });

  const onSave = () => {
    if (!f.buyerId) return message.error('Select a buyer.');
    if (lines.filter((l) => l.description.trim()).length === 0) return message.error('Add at least one line.');
    save.mutate();
  };

  const cols: ColumnsType<ProformaLineDto> = [
    { title: 'Product', dataIndex: 'productId', width: 200, render: (v, _r, i) => (
      <Select allowClear showSearch optionFilterProp="label" style={{ width: 190 }} placeholder="(optional)" value={v || undefined}
        options={(products ?? []).map((p) => ({ label: `${p.factoryCode} — ${p.name}`, value: p.id }))}
        onChange={(val) => (val ? pickProduct(i, val) : setLine(i, { productId: null }))} /> ) },
    { title: 'Description', dataIndex: 'description', render: (v, _r, i) => <Input value={v} onChange={(e) => setLine(i, { description: e.target.value })} /> },
    { title: 'Qty', dataIndex: 'qty', width: 80, render: (v, _r, i) => <InputNumber min={1} value={v} onChange={(val) => setLine(i, { qty: val ?? 1 })} /> },
    { title: `Unit Price (${symbol})`, dataIndex: 'unitPrice', width: 160, render: (v, r, i) => (
      <Space.Compact>
        <InputNumber min={0} step={0.01} value={v} style={{ width: 100 }} onChange={(val) => setLine(i, { unitPrice: val ?? 0 })} />
        <Button icon={<ThunderboltOutlined />} disabled={!r.productId} title="Suggest from FOB" onClick={() => r.productId && pickProduct(i, r.productId)} />
      </Space.Compact> ) },
    { title: 'Amount', key: 'amt', align: 'right', width: 120, render: (_, r) => <b>{money((r.qty || 0) * (r.unitPrice || 0), symbol)}</b> },
    { title: '', key: 'x', width: 40, render: (_, _r, i) => <Button danger type="text" icon={<DeleteOutlined />} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} /> },
  ];

  return (
    <div>
      <Breadcrumb style={{ marginBottom: 16 }} items={[{ title: <Link to="/"><HomeOutlined /></Link> }, { title: <Link to="/operations">Operations</Link> }, { title: <Link to="/operations/proformas">Proformas</Link> }, { title: editing ? pf?.number ?? 'Edit' : 'New Proforma' }]} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>{editing ? `Edit ${pf?.number ?? ''}` : 'New Proforma'}</Title>
        <Button type="primary" icon={<SaveOutlined />} loading={save.isPending} onClick={onSave}>Save</Button>
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[16, 12]}>
          <Col xs={24} md={8}><Text type="secondary">Buyer *</Text><Select showSearch optionFilterProp="label" style={{ width: '100%' }} value={f.buyerId} options={(buyers ?? []).map((b) => ({ label: `${b.code} · ${b.name}`, value: b.id }))} onChange={(v) => set({ buyerId: v })} /></Col>
          <Col xs={12} md={4}><Text type="secondary">Currency</Text><Select style={{ width: '100%' }} value={f.currencyId} options={(currencies ?? []).map((c) => ({ label: `${c.code}`, value: c.id }))} onChange={(v) => set({ currencyId: v })} /></Col>
          <Col xs={12} md={6}><Text type="secondary">Date</Text><DatePicker style={{ width: '100%' }} value={f.date} onChange={(d) => set({ date: d })} /></Col>
          <Col xs={12} md={6}><Text type="secondary">Valid until</Text><DatePicker style={{ width: '100%' }} value={f.validUntil} onChange={(d) => set({ validUntil: d })} /></Col>
          <Col xs={12} md={8}><Text type="secondary">Payment terms</Text><Input value={f.paymentTerms} onChange={(e) => set({ paymentTerms: e.target.value })} placeholder="30% advance, balance vs BL" /></Col>
          <Col xs={12} md={8}><Text type="secondary">Delivery terms</Text><Input value={f.deliveryTerms} onChange={(e) => set({ deliveryTerms: e.target.value })} placeholder="Within 60 days" /></Col>
          <Col xs={12} md={8}><Text type="secondary">Incoterms</Text><Input value={f.incoterms} onChange={(e) => set({ incoterms: e.target.value })} placeholder="FOB Mundra" /></Col>
          <Col xs={24} md={12}><Text type="secondary">Bank details</Text><Input.TextArea rows={3} value={f.bankDetails} onChange={(e) => set({ bankDetails: e.target.value })} /></Col>
          <Col xs={24} md={12}><Text type="secondary">Notes</Text><Input.TextArea rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Col>
        </Row>
      </Card>

      <Card size="small" title="Lines" extra={<Button size="small" icon={<PlusOutlined />} onClick={addLine}>Add line</Button>}>
        <Table<ProformaLineDto> rowKey={(_, i) => String(i)} size="small" columns={cols} dataSource={lines} pagination={false} />
        <div style={{ textAlign: 'right', marginTop: 12 }}><Text type="secondary">Total: </Text><Text strong style={{ fontSize: 16 }}>{money(total, symbol)}</Text></div>
      </Card>
    </div>
  );
}
