import { useEffect, useState } from 'react';
import { Breadcrumb, Button, Card, Checkbox, Col, Drawer, InputNumber, Progress, Result, Row, Select, Skeleton, Space, Table, Tag, Typography, Input, App } from 'antd';
import { HomeOutlined, ArrowLeftOutlined, PrinterOutlined, PlusOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../../api/client';
import { useSheet, useSuppliers, STAGE_STATUSES, type OpStage, type OpExplosion } from '../../api/ops';
import { useMeta } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { money, num, headColor } from '../../util/format';

const { Title, Text } = Typography;
const HEAD_ORDER = ['MAIN_COMPONENT', 'SUB_COMPONENT', 'HARDWARE', 'POLISHING', 'PACKAGING', 'LABOUR', 'FORWARDING'];
const SHEET_STATUS_COLOR: Record<string, string> = { Draft: 'default', InProgress: 'gold', Completed: 'green' };
const STAGE_COLOR: Record<string, string> = { NOT_STARTED: 'default', IN_PROGRESS: 'gold', DONE: 'green' };

export default function SheetDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { hasRole } = useAuth();
  const editable = hasRole('Operator');
  const { data: s, isLoading, isError } = useSheet(id);
  const { data: meta } = useMeta();
  const { data: vendors } = useSuppliers('JOBWORK');

  const [qty, setQty] = useState(1);
  const [produced, setProduced] = useState(0);
  const [drawerHead, setDrawerHead] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [printHeads, setPrintHeads] = useState<string[]>([]);

  useEffect(() => { if (s) { setQty(s.qty); setProduced(s.producedQty); } }, [s]);

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['op-sheet', id] }); qc.invalidateQueries({ queryKey: ['op-sheets'] }); qc.invalidateQueries({ queryKey: ['orders'] }); qc.invalidateQueries({ queryKey: ['ops-dashboard'] }); };
  const updateSheet = useMutation({ mutationFn: (body: any) => api.put(`/operation-sheets/${id}`, body), onSuccess: () => { message.success('Saved.'); invalidate(); }, onError: (e) => message.error(apiError(e)) });
  const addStage = useMutation({ mutationFn: () => api.post(`/operation-sheets/${id}/stages`, { name: 'New Stage' }), onSuccess: invalidate, onError: (e) => message.error(apiError(e)) });
  const updateStage = useMutation({ mutationFn: ({ stageId, data }: { stageId: number; data: any }) => api.patch(`/operation-sheets/${id}/stages/${stageId}`, data), onSuccess: invalidate, onError: (e) => message.error(apiError(e)) });
  const delStage = useMutation({ mutationFn: (stageId: number) => api.delete(`/operation-sheets/${id}/stages/${stageId}`), onSuccess: invalidate, onError: (e) => message.error(apiError(e)) });

  if (isLoading) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (isError || !s) return <Result status="404" title="Sheet not found" extra={<Button onClick={() => navigate('/operations/sheets')}>Back</Button>} />;

  const ex = s.explosion;
  const symbol = ex?.currency?.symbol ?? '₹';
  const headLabel = (h: string) => meta?.heads.find((x) => x.code === h)?.label ?? h;
  const presentHeads = HEAD_ORDER.filter((h) => (ex?.groups || []).some((g) => g.head === h));
  const producedPct = s.qty ? Math.round((s.producedQty / s.qty) * 100) : 0;

  const doPrint = (heads: string[]) => { setPrintHeads(heads); setTimeout(() => window.print(), 80); };

  const renderSection = (ex: OpExplosion, head: string) => (
    <div key={head} style={{ marginBottom: 16 }}>
      <div className="cost-head-bar" style={{ background: headColor(head), display: 'flex', justifyContent: 'space-between' }}>
        <span>{headLabel(head)}</span>
        <span>{money(ex.order.headTotals[head] ?? 0, symbol)}</span>
      </div>
      {ex.groups.filter((g) => g.head === head).map((g) => (
        <Card key={g.name} size="small" style={{ marginTop: 8 }} title={<span>{g.name} <Tag>{g.method}</Tag></span>} extra={<Text strong>{money(g.orderTotal, symbol)}</Text>}>
          <table className="doc-table">
            <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>Per pc</th><th style={{ textAlign: 'right' }}>× {s.qty}</th><th style={{ textAlign: 'right' }}>Amt/pc</th><th style={{ textAlign: 'right' }}>Order amt</th></tr></thead>
            <tbody>
              {g.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.name}{l.unit ? <span style={{ color: '#999' }}> ({l.unit})</span> : ''}</td>
                  <td style={{ textAlign: 'right' }}>{num(l.measure, 3)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{num(l.orderMeasure, 3)}</td>
                  <td style={{ textAlign: 'right' }}>{money(l.amount, symbol)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(l.orderAmount, symbol)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );

  const stageCols = [
    { title: 'Stage', dataIndex: 'name', render: (v: string, r: OpStage) => editable ? <Input size="small" defaultValue={v} style={{ width: 130 }} onBlur={(e) => e.target.value !== v && updateStage.mutate({ stageId: r.id, data: { name: e.target.value } })} /> : v },
    { title: 'Worker / note', dataIndex: 'assignee', render: (v: string, r: OpStage) => editable ? <Input size="small" placeholder="worker" defaultValue={v ?? ''} style={{ width: 160 }} onBlur={(e) => updateStage.mutate({ stageId: r.id, data: { assignee: e.target.value } })} /> : (v ?? '—') },
    { title: `Done / ${s.qty}`, dataIndex: 'qtyDone', width: 110, render: (v: number, r: OpStage) => editable ? <InputNumber size="small" min={0} max={s.qty} value={v} style={{ width: 90 }} onChange={(val) => updateStage.mutate({ stageId: r.id, data: { qtyDone: val ?? 0 } })} /> : v },
    { title: 'Status', dataIndex: 'status', width: 150, render: (v: string, r: OpStage) => editable ? <Select size="small" value={v} style={{ width: 140 }} onChange={(val) => updateStage.mutate({ stageId: r.id, data: { status: val } })} options={STAGE_STATUSES.map((x) => ({ label: x.replace('_', ' '), value: x }))} /> : <Tag color={STAGE_COLOR[v]}>{v}</Tag> },
    ...(editable ? [{ title: '', key: 'x', width: 40, render: (_: any, r: OpStage) => <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={() => delStage.mutate(r.id)} /> }] : []),
  ];

  return (
    <div>
      <div className="no-print">
        <Breadcrumb style={{ marginBottom: 16 }} items={[{ title: <Link to="/"><HomeOutlined /></Link> }, { title: <Link to="/operations">Operations</Link> }, { title: <Link to="/operations/sheets">Operation Sheets</Link> }, { title: s.number }]} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <Space><Title level={3} style={{ margin: 0 }}>{s.number}</Title><Tag color={SHEET_STATUS_COLOR[s.status]}>{s.status}</Tag><Text type="secondary">{s.product.factoryCode} · {s.product.name}</Text></Space>
          <Space wrap>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/operations/sheets')}>Back</Button>
            <Button icon={<PrinterOutlined />} onClick={() => doPrint(presentHeads)}>Print full sheet</Button>
          </Space>
        </div>

        {/* STATUS + PROGRESS — the main focus */}
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col xs={24} lg={14}>
            <Card size="small" title="Status & progress">
              <Row gutter={[16, 12]} align="middle">
                <Col xs={24} md={10}>
                  <Text type="secondary">Made {s.producedQty} of {s.qty} pcs</Text>
                  <Progress percent={producedPct} status={producedPct >= 100 ? 'success' : 'active'} strokeColor="#6d4c41" />
                </Col>
                <Col xs={12} md={7}>
                  <Text type="secondary">Sheet status</Text>
                  {editable ? <Select value={s.status} style={{ width: '100%' }} onChange={(v) => updateSheet.mutate({ status: v })} options={['Draft', 'InProgress', 'Completed'].map((x) => ({ label: x, value: x }))} /> : <div><Tag color={SHEET_STATUS_COLOR[s.status]}>{s.status}</Tag></div>}
                </Col>
                <Col xs={12} md={7}>
                  <Text type="secondary">Produced qty</Text>
                  {editable ? <Space.Compact style={{ width: '100%' }}><InputNumber min={0} max={s.qty} value={produced} onChange={(v) => setProduced(v ?? 0)} style={{ width: '65%' }} /><Button onClick={() => updateSheet.mutate({ producedQty: produced })}>Set</Button></Space.Compact> : <div>{s.producedQty}</div>}
                </Col>
              </Row>
            </Card>
          </Col>
          <Col xs={24} lg={10}>
            <Card size="small" title="Production mode">
              <Row gutter={[12, 12]} align="middle">
                <Col span={10}>
                  <Text type="secondary">Sheet qty</Text>
                  {editable ? <Space.Compact style={{ width: '100%' }}><InputNumber min={1} value={qty} onChange={(v) => setQty(v ?? 1)} style={{ width: '60%' }} /><Button onClick={() => updateSheet.mutate({ qty })}>Set</Button></Space.Compact> : <div>{s.qty}</div>}
                </Col>
                <Col span={14}>
                  <Text type="secondary">Mode</Text>
                  {editable ? <Select value={s.mode} style={{ width: '100%' }} onChange={(v) => updateSheet.mutate({ mode: v, ...(v === 'INHOUSE' ? { vendorId: null } : {}) })} options={[{ label: 'In-house', value: 'INHOUSE' }, { label: 'Outsourced (jobwork)', value: 'OUTSOURCED' }]} /> : <Tag color={s.mode === 'OUTSOURCED' ? 'volcano' : 'blue'}>{s.mode}</Tag>}
                </Col>
                {s.mode === 'OUTSOURCED' && (
                  <>
                    <Col span={14}><Text type="secondary">Jobwork vendor</Text>{editable ? <Select allowClear value={s.vendorId ?? undefined} style={{ width: '100%' }} placeholder="Vendor" onChange={(v) => updateSheet.mutate({ vendorId: v ?? null })} options={(vendors ?? []).map((x) => ({ label: x.name, value: x.id }))} /> : (s.vendor?.name ?? '—')}</Col>
                    <Col span={10}><Text type="secondary">Jobwork ₹</Text>{editable ? <InputNumber min={0} value={s.jobworkCost} style={{ width: '100%' }} onChange={(v) => updateSheet.mutate({ jobworkCost: v ?? 0 })} /> : money(s.jobworkCost, '₹')}</Col>
                  </>
                )}
              </Row>
            </Card>
          </Col>
        </Row>

        {/* STAGES */}
        <Card size="small" title="Production stages" style={{ marginBottom: 16 }} extra={editable && <Button size="small" icon={<PlusOutlined />} onClick={() => addStage.mutate()}>Add stage</Button>}>
          <Table<OpStage> rowKey="id" size="small" columns={stageCols as any} dataSource={s.stages} pagination={false} scroll={{ x: 600 }} />
        </Card>

        {/* MATERIAL SECTIONS as buttons */}
        <Card size="small" title="Material & cost sections" extra={selected.length > 0 && <Button type="primary" icon={<PrinterOutlined />} onClick={() => doPrint(selected)}>Print selected ({selected.length})</Button>}>
          {!ex ? <Text type="secondary">This product has no costing sheet to explode.</Text> : (
            <Row gutter={[12, 12]}>
              {presentHeads.map((h) => (
                <Col key={h} xs={24} sm={12} md={8}>
                  <Card size="small" style={{ borderLeft: `4px solid ${headColor(h)}` }}
                    styles={{ body: { padding: 12 } }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Checkbox checked={selected.includes(h)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, h] : s.filter((x) => x !== h)))}>
                        <b>{headLabel(h)}</b>
                      </Checkbox>
                    </div>
                    <div style={{ margin: '6px 0', fontSize: 16, fontWeight: 600, color: '#4e342e' }}>{money(ex.order.headTotals[h] ?? 0, symbol)}</div>
                    <Space>
                      <Button size="small" icon={<EyeOutlined />} onClick={() => setDrawerHead(h)}>View</Button>
                      <Button size="small" icon={<PrinterOutlined />} onClick={() => doPrint([h])}>Print</Button>
                    </Space>
                  </Card>
                </Col>
              ))}
            </Row>
          )}
          {ex && (
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <Text type="secondary" style={{ marginRight: 12 }}>Order FOB: <b style={{ color: '#4e342e' }}>{money(ex.order.fob, symbol)}</b> · per pc {money(ex.perPiece.fob, symbol)}</Text>
            </div>
          )}
        </Card>
      </div>

      {/* Drawer to view a single section */}
      <Drawer title={drawerHead ? headLabel(drawerHead) : ''} open={!!drawerHead} onClose={() => setDrawerHead(null)} width={620}
        extra={drawerHead && <Button icon={<PrinterOutlined />} onClick={() => doPrint([drawerHead])}>Print</Button>}>
        {ex && drawerHead && renderSection(ex, drawerHead)}
      </Drawer>

      {/* Print area — renders only the selected/all sections */}
      <div className="print-area" style={{ display: printHeads.length ? undefined : 'none' }}>
        <div className="doc-sheet">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div><div style={{ fontSize: 18, fontWeight: 700, color: '#4e342e' }}>Operation Sheet — {s.number}</div><div>{s.product.factoryCode} · {s.product.name}</div></div>
            <div style={{ textAlign: 'right' }}><div>Qty: <b>{s.qty} pcs</b></div><div style={{ color: '#777' }}>{s.mode === 'OUTSOURCED' ? `Jobwork${s.vendor ? ': ' + s.vendor.name : ''}` : 'In-house'}</div></div>
          </div>
          <div style={{ marginTop: 16 }}>{ex && printHeads.map((h) => renderSection(ex, h))}</div>
        </div>
      </div>
    </div>
  );
}
