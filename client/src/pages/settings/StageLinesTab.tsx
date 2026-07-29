import { useState } from 'react';
import { App, Button, Card, Empty, Input, InputNumber, Modal, Popconfirm, Space, Switch, Tag, Tooltip, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, ArrowUpOutlined, ArrowDownOutlined, StarFilled } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../../api/client';
import { useStageLines, type StageLine } from '../../api/ops';

const { Text, Title } = Typography;

interface Draft {
  id?: number;
  code: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  notes: string;
  steps: { name: string; defaultDays: number | null }[];
}

const blank = (): Draft => ({ code: '', name: '', isDefault: false, isActive: true, notes: '', steps: [{ name: 'Raw joining', defaultDays: null }] });

/**
 * Stage lines are the production routes a product can travel. Editing one is
 * always safe: live order lines keep their own snapshot of the steps.
 */
export default function StageLinesTab() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { data: lines, isLoading } = useStageLines();
  const [draft, setDraft] = useState<Draft | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['stage-lines'] });
    qc.invalidateQueries({ queryKey: ['orders'] });
  };

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const body = {
        code: d.code.trim(),
        name: d.name.trim(),
        isDefault: d.isDefault,
        isActive: d.isActive,
        notes: d.notes.trim() || null,
        steps: d.steps.map((s) => ({ name: s.name.trim(), defaultDays: s.defaultDays })).filter((s) => s.name),
      };
      return d.id ? api.patch(`/stage-lines/${d.id}`, body) : api.post('/stage-lines', body);
    },
    onSuccess: () => {
      message.success('Stage line saved.');
      setDraft(null);
      refresh();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/stage-lines/${id}`),
    onSuccess: () => {
      message.success('Stage line deleted.');
      refresh();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const edit = (l: StageLine) =>
    setDraft({ id: l.id, code: l.code, name: l.name, isDefault: l.isDefault, isActive: l.isActive, notes: l.notes ?? '', steps: l.steps.map((s) => ({ name: s.name, defaultDays: s.defaultDays ?? null })) });

  const onSave = () => {
    if (!draft) return;
    if (!draft.code.trim()) return message.error('Give the line a short code, e.g. X.');
    if (!draft.name.trim()) return message.error('Give the line a name.');
    if (draft.steps.map((s) => s.name.trim()).filter(Boolean).length === 0) return message.error('Add at least one stage.');
    save.mutate(draft);
  };

  const setStep = (i: number, patch: Partial<{ name: string; defaultDays: number | null }>) =>
    setDraft((d) => (d ? { ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : d));
  const moveStep = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      if (!d) return d;
      const j = i + dir;
      if (j < 0 || j >= d.steps.length) return d;
      const steps = [...d.steps];
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...d, steps };
    });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <Text type="secondary" style={{ maxWidth: 620 }}>
          A stage line is the route a product travels on the floor. Assign one to each product; every order line then gets its own copy, so changing a line here never disturbs orders already
          running.
        </Text>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setDraft(blank())}>
          New stage line
        </Button>
      </div>

      {isLoading ? (
        <Card loading />
      ) : (lines ?? []).length === 0 ? (
        <Empty description="No stage lines yet" />
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {(lines ?? []).map((l) => (
            <Card
              key={l.id}
              size="small"
              title={
                <Space wrap>
                  <Tag color="#6d4c41" style={{ fontWeight: 700 }}>
                    {l.code}
                  </Tag>
                  <span>{l.name}</span>
                  {l.isDefault && (
                    <Tag icon={<StarFilled />} color="gold">
                      Default
                    </Tag>
                  )}
                  {!l.isActive && <Tag>Inactive</Tag>}
                </Space>
              }
              extra={
                <Space>
                  <Button size="small" icon={<EditOutlined />} onClick={() => edit(l)}>
                    Edit
                  </Button>
                  <Popconfirm title={`Delete stage line ${l.code}?`} onConfirm={() => del.mutate(l.id)} okButtonProps={{ danger: true }}>
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              }
            >
              <div className="stage-flow">
                {l.steps.map((s, i) => (
                  <span key={s.id} className="stage-flow-item">
                    <span className="stage-flow-num">{i + 1}</span>
                    {s.name}
                  </span>
                ))}
              </div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {l.steps.length} stage(s)
                {l._count ? ` · ${l._count.products} product(s) · ${l._count.orderLines} order line(s)` : ''}
                {l.notes ? ` · ${l.notes}` : ''}
              </Text>
            </Card>
          ))}
        </Space>
      )}

      <Modal
        title={draft?.id ? `Edit stage line ${draft.code}` : 'New stage line'}
        open={!!draft}
        onCancel={() => setDraft(null)}
        onOk={onSave}
        confirmLoading={save.isPending}
        okText="Save"
        width={620}
        destroyOnHidden
      >
        {draft && (
          <div style={{ marginTop: 12 }}>
            <Space align="start" wrap style={{ marginBottom: 12 }}>
              <div>
                <Text type="secondary">Code *</Text>
                <Input style={{ width: 110 }} value={draft.code} placeholder="X" onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
              </div>
              <div>
                <Text type="secondary">Name *</Text>
                <Input style={{ width: 260 }} value={draft.name} placeholder="Wood line" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div>
                <Text type="secondary" style={{ display: 'block' }}>
                  Default
                </Text>
                <Switch checked={draft.isDefault} onChange={(v) => setDraft({ ...draft, isDefault: v })} />
              </div>
              <div>
                <Text type="secondary" style={{ display: 'block' }}>
                  Active
                </Text>
                <Switch checked={draft.isActive} onChange={(v) => setDraft({ ...draft, isActive: v })} />
              </div>
            </Space>

            <Title level={5} style={{ marginBottom: 4 }}>
              Stages, in order
            </Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Pieces travel top to bottom. They can also be sent back up when QC rejects them.
            </Text>
            <div style={{ marginTop: 10 }}>
              {draft.steps.map((s, i) => (
                <Space.Compact key={i} style={{ width: '100%', marginBottom: 6 }}>
                  <Input style={{ width: 40, textAlign: 'center' }} value={i + 1} disabled />
                  <Input value={s.name} placeholder="Stage name" onChange={(e) => setStep(i, { name: e.target.value })} />
                  <Tooltip title="How long this stage usually takes. Used to auto-schedule an order backwards from its delivery date; left empty it takes an equal share of what is left.">
                    <InputNumber
                      style={{ width: 104 }}
                      min={0}
                      placeholder="days"
                      value={s.defaultDays ?? undefined}
                      onChange={(v) => setStep(i, { defaultDays: v ?? null })}
                      addonAfter="d"
                    />
                  </Tooltip>
                  <Button icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => moveStep(i, -1)} />
                  <Button icon={<ArrowDownOutlined />} disabled={i === draft.steps.length - 1} onClick={() => moveStep(i, 1)} />
                  <Button danger icon={<DeleteOutlined />} disabled={draft.steps.length === 1} onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })} />
                </Space.Compact>
              ))}
              <Button size="small" icon={<PlusOutlined />} onClick={() => setDraft({ ...draft, steps: [...draft.steps, { name: '', defaultDays: null }] })}>
                Add stage
              </Button>
            </div>

            <div style={{ marginTop: 14 }}>
              <Text type="secondary">Notes</Text>
              <Input.TextArea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
