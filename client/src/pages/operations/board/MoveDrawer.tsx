import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, DatePicker, Divider, Drawer, Input, InputNumber, Select, Space, Tag, Typography, Upload } from 'antd';
import { PictureOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, apiError } from '../../../api/client';
import { MOVE_COLOR, MOVE_LABEL, OPS_KEYS, uploadMovePhotos, type Order, type OrderLineDto } from '../../../api/ops';
import { availableAt, describe, deriveKind, hopsBetween, keyOf, labelOf, parseKey, suggestedTarget, targetsFor, validate, type Endpoint } from './moveLogic';

const { Text } = Typography;

export interface MoveTarget {
  line: OrderLineDto;
  from: Endpoint;
}

/**
 * One hand-over of pieces. You choose only where they are and where they are going;
 * the action (cleared / sent back / finished) is derived, so an illegal move cannot
 * be expressed. Crossing several stages at once records a hop per stage, keeping
 * each stage's count — and its jobwork — exact.
 */
export default function MoveDrawer({ order, target, onClose }: { order: Order; target: MoveTarget | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { message } = App.useApp();

  const [toKey, setToKey] = useState<string>();
  const [qty, setQty] = useState(1);
  const [comment, setComment] = useState('');
  const [date, setDate] = useState<dayjs.Dayjs>(dayjs());
  const [files, setFiles] = useState<UploadFile[]>([]);

  const board = target?.line.board;
  const from = target?.from ?? null;
  const fromKey = from ? keyOf(from) : undefined;
  const to = useMemo(() => (board ? parseKey(toKey, board.stages) : null), [toKey, board]);

  useEffect(() => {
    if (!target || !board) return;
    setToKey(keyOf(suggestedTarget(board, target.from)));
    setQty(Math.max(availableAt(board, target.from), 1));
    setComment('');
    setDate(dayjs());
    setFiles([]);
  }, [target?.line.id, fromKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalidate = () => {
    for (const key of OPS_KEYS) qc.invalidateQueries({ queryKey: key });
  };

  const post = useMutation({
    mutationFn: async () => {
      const res = await api.post<Order>(`/orders/${order.id}/moves`, {
        moves: [
          {
            orderLineId: target!.line.id,
            kind: deriveKind(from!, to!),
            fromStageId: from!.kind === 'STAGE' ? from!.stage.id : null,
            toStageId: to!.kind === 'STAGE' ? to!.stage.id : null,
            qty,
          },
        ],
        date: date.toISOString(),
        comment: comment.trim() || null,
      });
      const picked = files.map((f) => f.originFileObj).filter(Boolean) as File[];
      if (picked.length && res.data.photoMoveId) await uploadMovePhotos(res.data.photoMoveId, picked);
      return res.data;
    },
    onSuccess: (data) => {
      const bits = [describe(from!, to!, qty)];
      if ((data.createdMoves ?? 1) > 1) bits.push(`${data.createdMoves} stage hops recorded.`);
      if (files.length) bits.push(`${files.length} photo(s) attached.`);
      if (data.statusChangedTo) bits.push(`Order is now ${data.statusChangedTo}.`);
      message.success(bits.join(' '));
      invalidate();
      onClose();
    },
    onError: (e) => message.error(apiError(e)),
  });

  if (!target || !board) return <Drawer open={false} onClose={onClose} />;

  const error = validate(board, from, to, qty);
  const kind = from && to ? deriveKind(from, to) : null;
  const available = availableAt(board, target.from);
  const hops = from && to ? hopsBetween(board, from, to) : [];
  const crossing = hops.filter((s) => s.vendorId);
  /** Finishing from anywhere but the last stage jumps over the rest of the line. */
  const skipped =
    kind === 'COMPLETE' && from?.kind === 'STAGE' ? board.stages.filter((s) => s.sortOrder > from.stage.sortOrder) : [];

  return (
    <Drawer
      open
      width={520}
      onClose={onClose}
      title={
        <Space direction="vertical" size={0}>
          <span>Pass pieces on</span>
          <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
            {target.line.product.factoryCode} — {target.line.product.name}
          </Text>
        </Space>
      }
      footer={
        <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" loading={post.isPending} disabled={!!error} onClick={() => post.mutate()}>
            {kind ? MOVE_LABEL[kind] : 'Record'} {qty} pc{qty === 1 ? '' : 's'}
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <div>
          <Text type="secondary">From</Text>
          <div>
            <Tag color="#6d4c41" style={{ fontSize: 14, padding: '4px 10px' }}>
              {labelOf(target.from)}
            </Tag>
            <Text type="secondary">{available} pc(s) here</Text>
          </div>
        </div>

        <div>
          <Text type="secondary">Pass to *</Text>
          <Select
            style={{ width: '100%' }}
            value={toKey}
            onChange={setToKey}
            options={targetsFor(board, from).map((t) => ({
              value: t.value,
              label: (
                <span>
                  {t.label}
                  {t.hint && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {' '}
                      · {t.hint}
                    </Text>
                  )}
                </span>
              ),
            }))}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            Pick any stage ahead — several stages at once is fine.
          </Text>
        </div>

        <div>
          <Text type="secondary">Pieces *</Text>
          <Space.Compact style={{ width: '100%' }}>
            <InputNumber min={1} max={Math.max(available, 1)} value={qty} onChange={(v) => setQty(v ?? 1)} style={{ width: '100%' }} />
            <Button onClick={() => setQty(available)} disabled={available < 1}>
              All {available}
            </Button>
          </Space.Compact>
        </div>

        {error ? (
          <Alert type="error" showIcon message={error} />
        ) : (
          <Alert
            type={kind === 'REJECT' ? 'warning' : 'info'}
            showIcon
            message={
              <span>
                <Tag color={MOVE_COLOR[kind!]}>{MOVE_LABEL[kind!]}</Tag>
                {describe(from!, to!, qty)}
              </span>
            }
            description={
              hops.length > 1 ? (
                <span>
                  Recorded as {hops.length} steps: {hops.map((s) => s.name).join(' → ')}.
                  {crossing.length > 0 && ` Jobwork counts for ${crossing.map((s) => s.vendor?.name ?? 'vendor').join(', ')}.`}
                </span>
              ) : skipped.length > 0 ? (
                <span>
                  Skips {skipped.map((s) => s.name).join(', ')} — nobody is credited for those stages
                  {skipped.some((s) => s.vendorId) ? `, including ${[...new Set(skipped.filter((s) => s.vendorId).map((s) => s.vendor?.name ?? 'a vendor'))].join(' and ')}` : ''}. Advance
                  through them first if that work was really done.
                </span>
              ) : undefined
            }
          />
        )}

        <div>
          <Text type="secondary">Date</Text>
          <DatePicker style={{ width: '100%' }} value={date} onChange={(d) => setDate(d ?? dayjs())} allowClear={false} />
        </div>

        <Divider style={{ margin: '4px 0' }} />

        <div>
          <Text strong>Hand-over note</Text>
          <Input.TextArea
            rows={3}
            placeholder="What is being passed on, in what condition, anything the next stage should know…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>

        <div>
          <Text strong>Photos</Text>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
            Proof of condition at the hand-over. Kept against this movement.
          </Text>
          <Upload
            listType="picture-card"
            multiple
            accept="image/*"
            fileList={files}
            beforeUpload={() => false}
            onChange={({ fileList }) => setFiles(fileList.slice(0, 10))}
          >
            {files.length < 10 && (
              <div>
                <PictureOutlined />
                <div style={{ marginTop: 6, fontSize: 12 }}>Add</div>
              </div>
            )}
          </Upload>
        </div>
      </Space>
    </Drawer>
  );
}
