import { useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Col, Divider, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography, App } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import { api, apiError } from '../../api/client';
import { evalExpr, validateExpr, ALLOWED_VARS } from '../../util/expr';

const { Text, Title, Paragraph } = Typography;

interface Method {
  id?: number;
  code: string;
  label: string;
  measureUnit: string;
  expression: string;
  usesL: boolean;
  usesW: boolean;
  usesH: boolean;
  usesWeight: boolean;
  usesWastage: boolean;
  dimUnit?: string | null;
  sortOrder: number;
  isActive: boolean;
  isBuiltIn?: boolean;
}

const blank: Method = {
  code: '', label: '', measureUnit: 'UNIT', expression: 'QTY',
  usesL: false, usesW: false, usesH: false, usesWeight: false, usesWastage: true,
  dimUnit: null, sortOrder: 0, isActive: true,
};

const VAR_HELP: Record<string, string> = {
  L: 'Costing length', W: 'Costing width', H: 'Costing height',
  AL: 'Actual length', AW: 'Actual width', AH: 'Actual height',
  QTY: 'Quantity', WASTAGE: 'Wastage %', WEIGHT: 'Actual weight',
};

export default function FormulasTab() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Method>(blank);
  const [sample, setSample] = useState<Record<string, number>>({ L: 10, W: 10, H: 10, AL: 10, AW: 10, AH: 10, QTY: 1, WASTAGE: 20, WEIGHT: 5 });

  const { data, isLoading } = useQuery({ queryKey: ['methods'], queryFn: async () => (await api.get<Method[]>('/methods')).data });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['methods'] });
    qc.invalidateQueries({ queryKey: ['meta'] });
  };

  const save = useMutation({
    mutationFn: async (m: Method) => {
      const body = { ...m };
      if (m.id) return api.patch(`/methods/${m.id}`, body);
      return api.post('/methods', body);
    },
    onSuccess: () => { message.success('Formula saved.'); setOpen(false); invalidate(); },
    onError: (e) => message.error(apiError(e)),
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/methods/${id}`),
    onSuccess: () => { message.success('Deleted.'); invalidate(); },
    onError: (e) => message.error(apiError(e)),
  });

  const exprError = useMemo(() => validateExpr(draft.expression || '', ALLOWED_VARS), [draft.expression]);
  const testResult = useMemo(() => {
    if (exprError) return null;
    try {
      return evalExpr(draft.expression, sample);
    } catch {
      return null;
    }
  }, [draft.expression, sample, exprError]);

  const openNew = () => { setDraft(blank); setOpen(true); };
  const openEdit = (m: Method) => { setDraft(m); setOpen(true); };

  const columns: ColumnsType<Method> = [
    { title: 'Code', dataIndex: 'code', width: 90, render: (c, r) => <Space><b>{c}</b>{r.isBuiltIn && <Tag color="blue">built-in</Tag>}</Space> },
    { title: 'Name', dataIndex: 'label' },
    { title: 'Unit', dataIndex: 'measureUnit', width: 80 },
    { title: 'Formula', dataIndex: 'expression', render: (e) => <Text code>{e}</Text> },
    {
      title: 'Inputs',
      key: 'inputs',
      render: (_, r) => (
        <Space size={4} wrap>
          {r.usesL && <Tag>L</Tag>}{r.usesW && <Tag>W</Tag>}{r.usesH && <Tag>H</Tag>}
          {r.usesWeight && <Tag>Weight</Tag>}{r.usesWastage && <Tag>Wastage</Tag>}
        </Space>
      ),
    },
    { title: 'Active', dataIndex: 'isActive', width: 70, render: (v) => (v ? <Tag color="green">Yes</Tag> : <Tag>No</Tag>) },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Popconfirm title="Delete this formula?" onConfirm={() => del.mutate(r.id!)} okButtonProps={{ danger: true }} disabled={r.isBuiltIn}>
            <Button size="small" danger icon={<DeleteOutlined />} disabled={r.isBuiltIn} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const set = (patch: Partial<Method>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <div>
      <Paragraph type="secondary">
        Costing methods are formulas. Use variables <Text code>L W H</Text> (costing dims), <Text code>AL AW AH</Text> (actual dims),
        {' '}<Text code>QTY</Text>, <Text code>WASTAGE</Text>, <Text code>WEIGHT</Text> with <Text code>+ - * / ^ ( )</Text>. The result is the
        {' '}<b>measure</b>; the line amount is measure × rate.
      </Paragraph>
      <Button type="primary" icon={<PlusOutlined />} onClick={openNew} style={{ marginBottom: 12 }}>
        Add Formula
      </Button>
      <Table<Method> rowKey="id" size="small" loading={isLoading} columns={columns} dataSource={data ?? []} pagination={false} />

      <Modal
        title={draft.id ? `Edit formula — ${draft.code}` : 'New formula'}
        open={open}
        width={640}
        onCancel={() => setOpen(false)}
        okText="Save"
        okButtonProps={{ disabled: !!exprError || !draft.code.trim() || !draft.label.trim() }}
        onOk={() => save.mutate(draft)}
        confirmLoading={save.isPending}
        destroyOnHidden
      >
        <Row gutter={12}>
          <Col span={6}>
            <Text type="secondary">Code *</Text>
            <Input value={draft.code} disabled={draft.isBuiltIn} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder="CBM" />
          </Col>
          <Col span={12}>
            <Text type="secondary">Name *</Text>
            <Input value={draft.label} onChange={(e) => set({ label: e.target.value })} placeholder="Cubic Metre (volume)" />
          </Col>
          <Col span={6}>
            <Text type="secondary">Measure unit</Text>
            <Input value={draft.measureUnit} onChange={(e) => set({ measureUnit: e.target.value })} placeholder="CBM" />
          </Col>
        </Row>

        <div style={{ marginTop: 12 }}>
          <Text type="secondary">Formula *</Text>
          <Input
            value={draft.expression}
            status={exprError ? 'error' : undefined}
            onChange={(e) => set({ expression: e.target.value })}
            placeholder="L*W*H/1728*QTY"
          />
          <Space wrap size={4} style={{ marginTop: 6 }}>
            {ALLOWED_VARS.map((v) => (
              <Tag key={v} style={{ cursor: 'pointer' }} title={VAR_HELP[v]} onClick={() => set({ expression: draft.expression + v })}>
                {v}
              </Tag>
            ))}
          </Space>
          {exprError && <Alert type="error" showIcon message={exprError} style={{ marginTop: 8 }} />}
        </div>

        <Divider style={{ margin: '14px 0' }} />
        <Text type="secondary">Which input fields should show on each line?</Text>
        <div style={{ marginTop: 6 }}>
          <Space wrap>
            <Checkbox checked={draft.usesL} onChange={(e) => set({ usesL: e.target.checked })}>Length (L)</Checkbox>
            <Checkbox checked={draft.usesW} onChange={(e) => set({ usesW: e.target.checked })}>Width (W)</Checkbox>
            <Checkbox checked={draft.usesH} onChange={(e) => set({ usesH: e.target.checked })}>Height (H)</Checkbox>
            <Checkbox checked={draft.usesWeight} onChange={(e) => set({ usesWeight: e.target.checked })}>Weight</Checkbox>
            <Checkbox checked={draft.usesWastage} onChange={(e) => set({ usesWastage: e.target.checked })}>Wastage %</Checkbox>
          </Space>
        </div>
        <Row gutter={12} style={{ marginTop: 12 }}>
          <Col span={8}>
            <Text type="secondary">Dimension unit</Text>
            <Select
              style={{ width: '100%' }}
              allowClear
              value={draft.dimUnit ?? undefined}
              onChange={(v) => set({ dimUnit: v ?? null })}
              options={[{ label: 'Inches', value: 'IN' }, { label: 'Centimetres', value: 'CM' }]}
            />
          </Col>
          <Col span={8}>
            <Text type="secondary">Sort order</Text>
            <InputNumber style={{ width: '100%' }} value={draft.sortOrder} onChange={(v) => set({ sortOrder: v ?? 0 })} />
          </Col>
          <Col span={8}>
            <Text type="secondary">Active</Text>
            <div><Checkbox checked={draft.isActive} onChange={(e) => set({ isActive: e.target.checked })}>Active</Checkbox></div>
          </Col>
        </Row>

        <Divider style={{ margin: '14px 0' }} />
        <Title level={5} style={{ marginTop: 0 }}>Test the formula</Title>
        <Space wrap>
          {ALLOWED_VARS.map((v) => (
            <span key={v}>
              <Text type="secondary" style={{ fontSize: 12 }}>{v} </Text>
              <InputNumber size="small" style={{ width: 70 }} value={sample[v]} onChange={(val) => setSample((s) => ({ ...s, [v]: val ?? 0 }))} />
            </span>
          ))}
        </Space>
        <div style={{ marginTop: 10 }}>
          <Text>Result (measure): </Text>
          <Text strong style={{ fontSize: 16 }}>{exprError ? '—' : testResult?.toLocaleString('en-IN', { maximumFractionDigits: 4 })}</Text>
          {draft.measureUnit && !exprError && <Text type="secondary"> {draft.measureUnit}</Text>}
        </div>
      </Modal>
    </div>
  );
}
