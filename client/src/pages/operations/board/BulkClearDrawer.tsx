import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Checkbox, DatePicker, Drawer, Empty, Input, InputNumber, Select, Space, Table, Tag, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, apiError } from '../../../api/client';
import { OPS_KEYS, type MoveInput, type Order, type OrderLineDto, type StageCell } from '../../../api/ops';
import { DONE_KEY, deriveKind, keyOf, labelOf, parseKey, suggestedTarget, targetsFor, validate, type Endpoint } from './moveLogic';

const { Text } = Typography;

interface Row {
  key: string;
  line: OrderLineDto;
  stage: StageCell;
  at: number;
  picked: boolean;
  qty: number;
  toKey: string;
}

/**
 * Clear the same point of the process across several order lines in one go — the
 * way a floor supervisor actually reports a day: "QC passed on all four items."
 */
export default function BulkClearDrawer({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { message } = App.useApp();

  const [stageName, setStageName] = useState<string>();
  const [rows, setRows] = useState<Row[]>([]);
  const [comment, setComment] = useState('');
  const [date, setDate] = useState<dayjs.Dayjs>(dayjs());

  /** Stage names that currently hold pieces, with how many lines and pieces sit there. */
  const stageOptions = useMemo(() => {
    const map = new Map<string, { lines: number; pieces: number }>();
    for (const l of order.lines) {
      for (const s of l.board.stages) {
        if (s.at <= 0) continue;
        const row = map.get(s.name) ?? { lines: 0, pieces: 0 };
        row.lines += 1;
        row.pieces += s.at;
        map.set(s.name, row);
      }
    }
    return Array.from(map.entries()).map(([name, v]) => ({ name, ...v }));
  }, [order]);

  useEffect(() => {
    if (!open) return;
    setStageName(stageOptions[0]?.name);
    setComment('');
    setDate(dayjs());
  }, [open, order.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rebuild the row list whenever the chosen stage changes.
  useEffect(() => {
    if (!stageName) {
      setRows([]);
      return;
    }
    const next: Row[] = [];
    for (const l of order.lines) {
      const stage = l.board.stages.find((s) => s.name === stageName && s.at > 0);
      if (!stage) continue;
      const from: Endpoint = { kind: 'STAGE', stage };
      next.push({ key: `${l.id}-${stage.id}`, line: l, stage, at: stage.at, picked: true, qty: stage.at, toKey: keyOf(suggestedTarget(l.board, from)) });
    }
    setRows(next);
  }, [stageName, order]);

  const chosen = rows.filter((r) => r.picked && r.qty > 0);
  const errors = chosen
    .map((r) => {
      const from: Endpoint = { kind: 'STAGE', stage: r.stage };
      const to = parseKey(r.toKey, r.line.board.stages);
      const err = validate(r.line.board, from, to, r.qty);
      return err ? `${r.line.product.factoryCode}: ${err}` : null;
    })
    .filter(Boolean) as string[];

  const post = useMutation({
    mutationFn: () => {
      const moves: MoveInput[] = chosen.map((r) => {
        const from: Endpoint = { kind: 'STAGE', stage: r.stage };
        const to = parseKey(r.toKey, r.line.board.stages)!;
        return {
          orderLineId: r.line.id,
          kind: deriveKind(from, to)!,
          fromStageId: r.stage.id,
          toStageId: to.kind === 'STAGE' ? to.stage.id : null,
          qty: r.qty,
        };
      });
      return api.post<Order>(`/orders/${order.id}/moves`, { moves, date: date.toISOString(), comment: comment.trim() || null });
    },
    onSuccess: (res) => {
      const data = res.data;
      message.success(`${data.createdMoves} movement(s) recorded across ${chosen.length} line(s).${data.statusChangedTo ? ` Order is now ${data.statusChangedTo}.` : ''}`);
      for (const key of OPS_KEYS) qc.invalidateQueries({ queryKey: key });
      onClose();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const setRow = (key: string, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const cols = [
    {
      title: <Checkbox checked={rows.length > 0 && rows.every((r) => r.picked)} onChange={(e) => setRows((prev) => prev.map((r) => ({ ...r, picked: e.target.checked })))} />,
      key: 'pick',
      width: 40,
      render: (_: unknown, r: Row) => <Checkbox checked={r.picked} onChange={(e) => setRow(r.key, { picked: e.target.checked })} />,
    },
    {
      title: 'Item',
      key: 'item',
      render: (_: unknown, r: Row) => (
        <span>
          <Text strong>{r.line.product.factoryCode}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {' '}
            {r.line.product.name}
          </Text>
        </span>
      ),
    },
    { title: 'Here', dataIndex: 'at', width: 64, align: 'right' as const, render: (v: number) => <Tag color="gold">{v}</Tag> },
    {
      title: 'Pieces',
      key: 'qty',
      width: 90,
      render: (_: unknown, r: Row) => <InputNumber size="small" min={1} max={r.at} value={r.qty} disabled={!r.picked} style={{ width: 78 }} onChange={(v) => setRow(r.key, { qty: v ?? 1 })} />,
    },
    {
      title: 'Pass to',
      key: 'to',
      width: 190,
      render: (_: unknown, r: Row) => (
        <Select
          size="small"
          style={{ width: 180 }}
          value={r.toKey}
          disabled={!r.picked}
          onChange={(v) => setRow(r.key, { toKey: v })}
          options={targetsFor(r.line.board, { kind: 'STAGE', stage: r.stage }).map((t) => ({ value: t.value, label: t.label }))}
        />
      ),
    },
  ];

  return (
    <Drawer
      open={open}
      width={720}
      onClose={onClose}
      title="Clear a stage across several items"
      footer={
        <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" loading={post.isPending} disabled={chosen.length === 0 || errors.length > 0} onClick={() => post.mutate()}>
            Pass on {chosen.reduce((a, r) => a + r.qty, 0)} pc(s) · {chosen.length} item(s)
          </Button>
        </Space>
      }
    >
      {stageOptions.length === 0 ? (
        <Empty description="Nothing is sitting at a stage yet — start some pieces first." />
      ) : (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <div>
            <Text type="secondary">Stage to clear</Text>
            <Select
              style={{ width: '100%' }}
              value={stageName}
              onChange={setStageName}
              options={stageOptions.map((s) => ({ value: s.name, label: `${s.name} — ${s.pieces} pc(s) across ${s.lines} item(s)` }))}
            />
          </div>

          <Table<Row> rowKey="key" size="small" columns={cols} dataSource={rows} pagination={false} />

          {errors.length > 0 && <Alert type="error" showIcon message={errors[0]} />}

          <div>
            <Text type="secondary">Date</Text>
            <DatePicker style={{ width: '100%' }} value={date} onChange={(d) => setDate(d ?? dayjs())} allowClear={false} />
          </div>

          <div>
            <Text strong>Hand-over note</Text>
            <Input.TextArea rows={3} placeholder="Applies to every movement in this batch" value={comment} onChange={(e) => setComment(e.target.value)} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Photos are attached per item — open a single bucket on the board for that.
            </Text>
          </div>
        </Space>
      )}
    </Drawer>
  );
}
