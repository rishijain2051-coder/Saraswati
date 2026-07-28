import { useEffect, useState } from 'react';
import { Breadcrumb, Button, Card, Col, Divider, Empty, InputNumber, Result, Row, Select, Skeleton, Space, Table, Tag, Typography, Input, App, Popconfirm } from 'antd';
import { HomeOutlined, ArrowLeftOutlined, PrinterOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import { api, apiError } from '../../api/client';
import { useSheet, useSuppliers, STAGE_STATUSES, type OpStage } from '../../api/ops';
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
  const [qty, setQty] = useState<number>(1);

  useEffect(() => { if (s) setQty(s.qty); }, [s]);

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['op-sheet', id] }); qc.invalidateQueries({ queryKey: ['op-sheets'] }); };
  const updateSheet = useMutation({ mutationFn: (body: any) => api.put(`/operation-sheets/${id}`, body), onSuccess: invalidate, onError: (e) => message.error(apiError(e)) });
  const addStage = useMutation({ mutationFn: () => api.post(`/operation-sheets/${id}/stages`, { name: 'New Stage' }), onSuccess: invalidate, onError: (e) => message.error(apiError(e)) });
  const updateStage = useMutation({ mutationFn: ({ stageId, data }: { stageId: number; data: any }) => api.patch(`/operation-sheets/${id}/stages/${stageId}`, data), onSuccess: invalidate, onError: (e) => message.error(apiError(e)) });
  const delStage = useMutation({ mutationFn: (stageId: number) => api.delete(`/operation-sheets/${id}/stages/${stageId}`), onSuccess: invalidate, onError: (e) => message.error(apiError(e)) });

  if (isLoading) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (isError || !s) return <Result status="404" title="Sheet not found" extra={<Button onClick={() => navigate('/operations/sheets')}>Back</Button>} />;

  const ex = s.explosion;
  const symbol = ex?.currency?.symbol ?? '₹';
  const headLabel = (h: string) => meta?.heads.find((x) => x.code === h)?.label ?? h;
  const jobworkTotal = s.stages.reduce((sum, st) => sum + (st.jobworkCost || 0), 0);

  const groupsByHead = HEAD_ORDER.map((head) => ({ head, groups: (ex?.groups || []).filter((g) => g.head === head) })).filter((h) => h.groups.length);

  const stageCols: ColumnsType<OpStage> = [
    { title: 'Stage', dataIndex: 'name', render: (v, r) => editable ? <Input size="small" defaultValue={v} onBlur={(e) => e.target.value !== v && updateStage.mutate({ stageId: r.id, data: { name: e.target.value } })} style={{ width: 130 }} /> : v },
    { title: 'Mode', dataIndex: 'mode', width: 130, render: (v, r) => editable ? <Select size="small" value={v} style={{ width: 120 }} onChange={(val) => updateStage.mutate({ stageId: r.id, data: { mode: val } })} options={[{ label: 'In-house', value: 'INHOUSE' }, { label: 'Outsourced', value: 'OUTSOURCED' }]} /> : <Tag>{v}</Tag> },
    { title: 'Vendor / Worker', key: 'who', width: 190, render: (_, r) => r.mode === 'OUTSOURCED'
      ? (editable ? <Select size="small" allowClear placeholder="Jobwork vendor" value={r.vendorId ?? undefined} style={{ width: 170 }} onChange={(val) => updateStage.mutate({ stageId: r.id, data: { vendorId: val ?? null } })} options={(vendors ?? []).map((v) => ({ label: v.name, value: v.id }))} /> : (r.vendor?.name ?? '—'))
      : (editable ? <Input size="small" placeholder="worker" defaultValue={r.assignee ?? ''} onBlur={(e) => updateStage.mutate({ stageId: r.id, data: { assignee: e.target.value } })} style={{ width: 170 }} /> : (r.assignee ?? '—')) },
    { title: 'Jobwork ₹', dataIndex: 'jobworkCost', width: 110, render: (v, r) => editable ? <InputNumber size="small" min={0} value={v} onChange={(val) => updateStage.mutate({ stageId: r.id, data: { jobworkCost: val ?? 0 } })} style={{ width: 100 }} /> : money(v, '₹') },
    { title: `Qty done / ${s.qty}`, dataIndex: 'qtyDone', width: 110, render: (v, r) => editable ? <InputNumber size="small" min={0} max={s.qty} value={v} onChange={(val) => updateStage.mutate({ stageId: r.id, data: { qtyDone: val ?? 0 } })} style={{ width: 90 }} /> : v },
    { title: 'Status', dataIndex: 'status', width: 150, render: (v, r) => editable ? <Select size="small" value={v} style={{ width: 140 }} onChange={(val) => updateStage.mutate({ stageId: r.id, data: { status: val } })} options={STAGE_STATUSES.map((x) => ({ label: x.replace('_', ' '), value: x }))} /> : <Tag color={STAGE_COLOR[v]}>{v}</Tag> },
    ...(editable ? [{ title: '', key: 'x', width: 40, render: (_: any, r: OpStage) => <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={() => delStage.mutate(r.id)} /> }] : []),
  ];

  return (
    <div>
      <div className="no-print">
        <Breadcrumb style={{ marginBottom: 16 }} items={[{ title: <Link to="/"><HomeOutlined /></Link> }, { title: <Link to="/operations">Operations</Link> }, { title: <Link to="/operations/sheets">Operation Sheets</Link> }, { title: s.number }]} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <Space><Title level={3} style={{ margin: 0 }}>{s.number}</Title><Tag color={SHEET_STATUS_COLOR[s.status]}>{s.status}</Tag></Space>
          <Space wrap>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/operations/sheets')}>Back</Button>
            {editable && (
              <Space.Compact>
                <InputNumber min={1} value={qty} onChange={(v) => setQty(v ?? 1)} />
                <Button onClick={() => updateSheet.mutate({ qty })}>Set qty</Button>
              </Space.Compact>
            )}
            {editable && <Select value={s.status} style={{ width: 140 }} onChange={(v) => updateSheet.mutate({ status: v })} options={['Draft', 'InProgress', 'Completed'].map((x) => ({ label: x, value: x }))} />}
            <Button icon={<PrinterOutlined />} onClick={() => window.print()}>Print / PDF</Button>
          </Space>
        </div>
      </div>

      <div className="print-area">
        <Card size="small" style={{ marginBottom: 16 }}>
          <Row>
            <Col span={16}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#4e342e' }}>Operation Sheet — {s.number}</div>
              <div>{s.product.factoryCode} · {s.product.name}</div>
              {s.order && <div style={{ color: '#777' }}>Order {s.order.number}</div>}
            </Col>
            <Col span={8} style={{ textAlign: 'right' }}>
              <Text type="secondary">Order quantity</Text>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{s.qty} pcs</div>
            </Col>
          </Row>
        </Card>

        {!ex ? (
          <Empty description="This product has no costing sheet to explode." />
        ) : (
          <Row gutter={16}>
            <Col xs={24} lg={16}>
              {groupsByHead.map(({ head, groups }) => (
                <div key={head} style={{ marginBottom: 16 }}>
                  <div className="cost-head-bar" style={{ background: headColor(head), display: 'flex', justifyContent: 'space-between' }}>
                    <span>{headLabel(head)}</span>
                    <span>{money(ex.order.headTotals[head] ?? 0, symbol)} <span style={{ opacity: 0.8, fontWeight: 400 }}>(order)</span></span>
                  </div>
                  {groups.map((g) => (
                    <Card key={g.name} size="small" style={{ marginTop: 8 }} title={<span>{g.name} <Tag>{g.method}</Tag></span>} extra={<Text strong>{money(g.orderTotal, symbol)}</Text>}>
                      <table className="doc-table">
                        <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>Per pc</th><th style={{ textAlign: 'right' }}>× {s.qty}</th><th style={{ textAlign: 'right' }}>Amount/pc</th><th style={{ textAlign: 'right' }}>Order amount</th></tr></thead>
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
              ))}
            </Col>
            <Col xs={24} lg={8}>
              <Card size="small" title="Totals" style={{ marginBottom: 16 }}>
                <Row justify="space-between"><Text>Ex-Factory / pc</Text><Text>{money(ex.perPiece.exFactory, symbol)}</Text></Row>
                <Row justify="space-between"><Text strong>FOB / pc</Text><Text strong>{money(ex.perPiece.fob, symbol)}</Text></Row>
                <Divider style={{ margin: '10px 0' }} />
                <Row justify="space-between"><Text>Ex-Factory × {s.qty}</Text><Text>{money(ex.order.exFactory, symbol)}</Text></Row>
                <Row justify="space-between" align="middle"><Title level={5} style={{ margin: 0 }}>Order FOB</Title><Title level={4} style={{ margin: 0, color: '#4e342e' }}>{money(ex.order.fob, symbol)}</Title></Row>
                {jobworkTotal > 0 && <Row justify="space-between" style={{ marginTop: 8 }}><Text type="secondary">Jobwork (stages)</Text><Text>{money(jobworkTotal, '₹')}</Text></Row>}
              </Card>
            </Col>
          </Row>
        )}

        <Card size="small" title="Production stages" extra={editable && <Button size="small" icon={<PlusOutlined />} onClick={() => addStage.mutate()} className="no-print">Add stage</Button>}>
          <Table<OpStage> rowKey="id" size="small" columns={stageCols} dataSource={s.stages} pagination={false} scroll={{ x: 800 }} />
        </Card>
      </div>
    </div>
  );
}
