import { useState } from 'react';
import { Alert, App, Breadcrumb, Button, Card, Col, Descriptions, Empty, Image, Modal, Popconfirm, Progress, Result, Row, Select, Skeleton, Space, Statistic, Tag, Timeline, Tooltip, Typography } from 'antd';
import {
  HomeOutlined,
  EditOutlined,
  ArrowLeftOutlined,
  ProfileOutlined,
  BranchesOutlined,
  UndoOutlined,
  ShopOutlined,
  HomeFilled,
  HistoryOutlined,
  EyeOutlined,
  ThunderboltOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, apiError } from '../../api/client';
import { useOrder, ORDER_STATUSES, ORDER_STATUS_COLOR, MOVE_COLOR, MOVE_LABEL, OPS_KEYS, type MoveKind, type OrderLineDto } from '../../api/ops';
import { useAuth } from '../../auth/AuthContext';
import { money } from '../../util/format';
import StageStrip from './board/StageStrip';
import MoveDrawer, { type MoveTarget } from './board/MoveDrawer';
import RoutingDrawer from './board/RoutingDrawer';
import BulkClearDrawer from './board/BulkClearDrawer';
import ChangeLogList from '../../components/ChangeLogList';

const { Title, Text } = Typography;

export default function OrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const { hasRole } = useAuth();
  const editable = hasRole('Operator');
  const { data: o, isLoading, isError } = useOrder(id);

  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [routingLine, setRoutingLine] = useState<OrderLineDto | null>(null);
  const [historyLine, setHistoryLine] = useState<OrderLineDto | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const invalidate = () => {
    for (const key of OPS_KEYS) qc.invalidateQueries({ queryKey: key });
  };

  const setStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/orders/${id}/status`, { status }),
    onSuccess: () => {
      message.success('Status updated.');
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const undoMove = useMutation({
    mutationFn: (moveId: number) => api.delete(`/moves/${moveId}`),
    onSuccess: () => {
      message.success('Movement undone.');
      invalidate();
      setHistoryLine(null);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const makeSheet = useMutation({
    mutationFn: (line: OrderLineDto) => api.post('/operation-sheets', { orderLineId: line.id }),
    onSuccess: (res) => navigate(`/operations/sheets/${(res.data as any).id}`),
    onError: (e) => message.error(apiError(e)),
  });

  if (isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (isError || !o) return <Result status="404" title="Order not found" extra={<Button onClick={() => navigate('/operations/orders')}>Back to orders</Button>} />;

  const symbol = o.currency?.symbol ?? '₹';
  const s = o.summary;
  const m = o.money;
  const missingRoutes = o.lines.filter((l) => l.needsStageLine);
  const anyPieces = o.lines.some((l) => l.board.stages.some((st) => st.at > 0));
  // A vendor stage left at ₹0 silently bills nothing — worth saying out loud.
  const unratedStages = o.lines.flatMap((l) =>
    l.board.stages.filter((st) => st.vendorId && st.jobworkRate <= 0).map((st) => ({ line: l, stage: st }))
  );

  const confirmStatus = (next: string) => {
    if (next === 'Cancelled') {
      modal.confirm({
        title: `Cancel order ${o.number}?`,
        content: 'Production movements are kept, but nothing further can be moved and the order drops out of the money totals.',
        okText: 'Cancel the order',
        okButtonProps: { danger: true },
        cancelText: 'Keep it open',
        onOk: () => setStatus.mutate(next),
      });
      return;
    }
    if (next === 'Shipped' && s.done < s.ordered) {
      modal.confirm({
        title: 'Ship an unfinished order?',
        content: `Only ${s.done} of ${s.ordered} pcs are finished. Mark it Shipped anyway?`,
        okText: 'Mark Shipped',
        onOk: () => setStatus.mutate(next),
      });
      return;
    }
    setStatus.mutate(next);
  };

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          { title: <Link to="/"><HomeOutlined /></Link> },
          { title: <Link to="/operations">Operations</Link> },
          { title: <Link to="/operations/orders">Orders</Link> },
          { title: o.number },
        ]}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <Space wrap>
          <Title level={3} style={{ margin: 0 }}>
            {o.number}
          </Title>
          <Tag color={ORDER_STATUS_COLOR[o.status] ?? 'default'}>{o.status}</Tag>
          <Text type="secondary">
            {o.buyer.name}
            {o.deliveryDate ? ` · delivery ${dayjs(o.deliveryDate).format('DD MMM YYYY')}` : ''}
          </Text>
        </Space>
        <Space wrap>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/operations/orders')}>
            Back
          </Button>
          {editable && anyPieces && (
            <Button icon={<ThunderboltOutlined />} onClick={() => setBulkOpen(true)}>
              Clear a stage
            </Button>
          )}
          {editable && <Select value={o.status} style={{ width: 150 }} onChange={confirmStatus} options={ORDER_STATUSES.map((x) => ({ label: x, value: x }))} />}
          {editable && (
            <Button icon={<EditOutlined />} onClick={() => navigate(`/operations/orders/${o.id}/edit`)}>
              Edit order
            </Button>
          )}
        </Space>
      </div>

      {/* PIECES */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[16, 12]} align="middle">
          <Col xs={24} md={9}>
            <Text type="secondary">
              {s.done} of {s.ordered} pcs finished
            </Text>
            <Progress percent={s.progressPct} status={s.progressPct >= 100 ? 'success' : 'active'} strokeColor="#6d4c41" />
          </Col>
          <Col xs={8} md={4}>
            <Statistic title="Not started" value={s.pending} valueStyle={{ fontSize: 20 }} />
          </Col>
          <Col xs={8} md={4}>
            <Statistic title="In production" value={s.wip} valueStyle={{ fontSize: 20, color: '#d48806' }} />
          </Col>
          <Col xs={8} md={3}>
            <Statistic title="Finished" value={s.done} valueStyle={{ fontSize: 20, color: '#389e0d' }} />
          </Col>
          <Col xs={24} md={4} style={{ textAlign: 'right' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Order value
            </Text>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#4e342e' }}>{money(o.total, symbol)}</div>
          </Col>
        </Row>
      </Card>

      {/* MONEY — all derived from this order and its board */}
      <Card size="small" style={{ marginBottom: 16 }} title={<Space><WalletOutlined /> Money on this order</Space>}
        extra={<Button size="small" onClick={() => navigate('/operations/payments')}>Payments</Button>}>
        <Row gutter={[16, 12]}>
          <Col xs={12} md={5}>
            <Statistic title="Invoiced" value={money(m.invoiced, symbol)} valueStyle={{ fontSize: 17 }} />
          </Col>
          <Col xs={12} md={5}>
            <Statistic title="Received" value={money(m.received, symbol)} valueStyle={{ fontSize: 17, color: '#389e0d' }} />
          </Col>
          <Col xs={12} md={5}>
            <Statistic
              title="Still to collect"
              value={money(m.receivable, symbol)}
              valueStyle={{ fontSize: 17, color: m.receivable > 0 ? '#cf1322' : '#389e0d' }}
            />
            {m.exchangeRate !== 1 && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                ≈ {money(m.receivableInr, '₹')}
              </Text>
            )}
          </Col>
          <Col xs={12} md={4}>
            <Statistic title="Jobwork earned" value={money(m.jobworkAccrued, '₹')} valueStyle={{ fontSize: 17 }} />
            <Text type="secondary" style={{ fontSize: 11 }}>
              paid {money(m.jobworkPaid, '₹')}
            </Text>
          </Col>
          <Col xs={12} md={5}>
            <Statistic title="Owed out (₹)" value={money(m.payableInr, '₹')} valueStyle={{ fontSize: 17, color: m.payableInr > 0 ? '#cf1322' : '#389e0d' }} />
            <Text type="secondary" style={{ fontSize: 11 }}>
              jobwork {money(m.jobworkDue, '₹')}
              {m.materialDue ? ` · material ${money(m.materialDue, '₹')}` : ''}
              {m.wagesDue ? ` · wages ${money(m.wagesDue, '₹')}` : ''}
            </Text>
          </Col>
        </Row>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Invoiced is the order value; jobwork earned counts each outsourced stage as its pieces clear. Record receipts and vendor payments on the Payments page — nothing here is typed in by hand.
        </Text>
      </Card>

      {missingRoutes.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`${missingRoutes.length} line(s) have no stage line yet`}
          description="Pieces cannot move until a route is set. Open “Who makes this?” on the line, or set a stage line on the product."
        />
      )}

      {unratedStages.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="A vendor stage has no jobwork rate, so it is billing nothing"
          description={
            <span>
              {unratedStages.map((u, i) => (
                <span key={`${u.line.id}-${u.stage.id}`}>
                  {i > 0 && ' · '}
                  <b>{u.stage.vendor?.name}</b> on “{u.stage.name}” of {u.line.product.factoryCode}
                  {u.stage.cleared > 0 ? ` (${u.stage.cleared} pcs already cleared)` : ''}
                </span>
              ))}
              . Set a ₹/pc rate in “Who makes this?” and the amount owed fills in for the pieces already done.
            </span>
          }
          action={
            editable && (
              <Button size="small" onClick={() => setRoutingLine(unratedStages[0].line)}>
                Set rate
              </Button>
            )
          }
        />
      )}

      {/* THE BOARD */}
      <Space direction="vertical" size={12} style={{ width: '100%', marginBottom: 16 }}>
        {o.lines.map((l) => (
          <Card
            key={l.id}
            size="small"
            className="board-line-card"
            styles={{ body: { paddingTop: 10 } }}
            title={
              <Space wrap size={8}>
                {l.product.primaryImage && <img src={l.product.primaryImage} alt="" className="board-thumb" />}
                <Link to={`/products/${l.product.id}`} style={{ fontWeight: 600 }}>
                  {l.product.factoryCode}
                </Link>
                <Text>{l.product.name}</Text>
                <Tag color="#6d4c41">{l.qty} pcs</Tag>
                {l.stageLine ? (
                  <Tag>
                    {l.stageLine.code} · {l.stageLine.name}
                  </Tag>
                ) : (
                  <Tag color="orange">No stage line</Tag>
                )}
                {l.mode === 'INHOUSE' ? (
                  <Tag icon={<HomeFilled />}>All in-house</Tag>
                ) : (
                  l.vendors.map((v) => (
                    <Tag key={v.id} color="volcano" icon={<ShopOutlined />}>
                      {v.name}: {l.outsourcedStages.filter((x) => x.id === v.id).map((x) => x.sortOrder + 1).join(', ')}
                    </Tag>
                  ))
                )}
              </Space>
            }
            extra={
              <Space wrap>
                <Text type="secondary">{money(l.amount, symbol)}</Text>
                {editable && (
                  <Button size="small" icon={<BranchesOutlined />} onClick={() => setRoutingLine(l)}>
                    Who makes this?
                  </Button>
                )}
                <Button size="small" icon={<HistoryOutlined />} disabled={l.history.length === 0} onClick={() => setHistoryLine(l)}>
                  History ({l.history.length})
                </Button>
                {l.sheet ? (
                  <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/operations/sheets/${l.sheet!.id}`)}>
                    {l.sheet.number}
                  </Button>
                ) : (
                  editable && (
                    <Button size="small" icon={<ProfileOutlined />} loading={makeSheet.isPending} onClick={() => makeSheet.mutate(l)}>
                      Material sheet
                    </Button>
                  )
                )}
              </Space>
            }
          >
            {l.needsStageLine ? (
              <Empty image={null} description={<Text type="secondary">No stage line on this line — set one to start tracking pieces.</Text>} style={{ margin: '8px 0' }}>
                {editable && (
                  <Button type="primary" ghost size="small" icon={<BranchesOutlined />} onClick={() => setRoutingLine(l)}>
                    Set stage line
                  </Button>
                )}
              </Empty>
            ) : (
              <>
                <StageStrip order={o} line={l} editable={editable} onMove={setMoveTarget} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 12, flexWrap: 'wrap' }}>
                  <Space size={8}>
                    <Progress percent={l.board.progressPct} size="small" style={{ width: 120 }} strokeColor="#6d4c41" />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {l.board.done} finished
                      {l.board.wip > 0 ? ` · ${l.board.wip} on the floor` : ''}
                      {l.board.pending > 0 ? ` · ${l.board.pending} not started` : ''}
                    </Text>
                  </Space>
                  <Space size={4} wrap>
                    {l.board.jobwork.map((j) => (
                      <Tag key={j.vendorId} color="volcano">
                        {j.vendorName}: {money(j.amount, '₹')} ({j.pieces} pcs)
                      </Tag>
                    ))}
                    {editable && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Click a bucket to pass pieces on with a note and photos · ✓ passes the lot straight on
                      </Text>
                    )}
                  </Space>
                </div>
              </>
            )}
          </Card>
        ))}
      </Space>

      <Row gutter={16}>
        <Col xs={24} lg={14}>
          <Card size="small" title="Order details">
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="Buyer">{o.buyer.name}</Descriptions.Item>
              <Descriptions.Item label="Currency">{o.currency?.code ?? 'INR'}</Descriptions.Item>
              <Descriptions.Item label="Order date">{dayjs(o.orderDate).format('DD MMM YYYY')}</Descriptions.Item>
              <Descriptions.Item label="Delivery">{o.deliveryDate ? dayjs(o.deliveryDate).format('DD MMM YYYY') : '—'}</Descriptions.Item>
              <Descriptions.Item label="Incoterms">{o.incoterms || '—'}</Descriptions.Item>
              <Descriptions.Item label="From proforma">{o.proforma ? <Link to={`/operations/proformas/${o.proforma.id}`}>{o.proforma.number}</Link> : '—'}</Descriptions.Item>
              <Descriptions.Item label="Notes" span={2}>
                {o.notes || '—'}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {/* Who changed a price or a stage rate, and what it was before — the one
              question the live order cannot answer, because an edit overwrites it. */}
          <Card size="small" title="Change history" style={{ marginTop: 16 }}>
            <ChangeLogList rootType="Order" rootId={o.id} what="order" compact />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          {o.jobwork.length > 0 && (
            <Card size="small" title="Jobwork earned so far" style={{ marginBottom: 16 }}>
              <Space direction="vertical" style={{ width: '100%' }} size={4}>
                {o.jobwork.map((j) => (
                  <div key={j.vendorId} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>
                      <Text>{j.vendorName}</Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {' '}
                        {j.stages.join(', ')}
                      </Text>
                    </span>
                    <Text strong>{money(j.amount, '₹')}</Text>
                  </div>
                ))}
              </Space>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Counted per piece as each outsourced stage clears.
              </Text>
            </Card>
          )}
          <Card size="small" title={`Money entries (${o.ledger.length})`}>
            {o.ledger.length === 0 ? (
              <Text type="secondary">No receipts or payments recorded against this order yet.</Text>
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size={6}>
                {o.ledger.map((e) => (
                  <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <Space size={6}>
                      <Tag color={e.partyType === 'BUYER' ? 'green' : 'volcano'}>{e.partyType === 'BUYER' ? 'IN' : 'OUT'}</Tag>
                      <Text style={{ fontSize: 12 }}>{e.partyName}</Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {dayjs(e.date).format('DD MMM')}
                        {e.ref ? ` · ${e.ref}` : ''}
                      </Text>
                    </Space>
                    <Text strong>
                      {e.currency ?? 'INR'} {e.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Text>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      <MoveDrawer order={o} target={moveTarget} onClose={() => setMoveTarget(null)} />
      <RoutingDrawer order={o} line={routingLine} onClose={() => setRoutingLine(null)} />
      <BulkClearDrawer order={o} open={bulkOpen} onClose={() => setBulkOpen(false)} />

      <Modal open={!!historyLine} onCancel={() => setHistoryLine(null)} footer={null} width={680} title={historyLine ? `Movements — ${historyLine.product.factoryCode}` : ''}>
        {historyLine && (
          <>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Newest first. Only the newest movement of a line can be undone.
            </Text>
            <Timeline
              style={{ marginTop: 16 }}
              items={historyLine.history.map((h, i) => ({
                color: MOVE_COLOR[h.kind as MoveKind] ?? 'gray',
                children: (
                  <div>
                    <Space wrap size={6}>
                      <Tag color={MOVE_COLOR[h.kind as MoveKind]}>{MOVE_LABEL[h.kind as MoveKind] ?? h.kind}</Tag>
                      <Text strong>{h.qty} pcs</Text>
                      <Text>
                        {h.fromStage ?? (h.kind === 'RETURN' ? 'Finished' : 'Not started')} → {h.toStage ?? (h.kind === 'REJECT' ? 'Not started' : 'Finished')}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {dayjs(h.date).format('DD MMM YYYY')}
                      </Text>
                    </Space>
                    {h.note && <div style={{ fontSize: 12, whiteSpace: 'pre-line', margin: '2px 0' }}>{h.note}</div>}
                    {h.workers.length > 0 && (
                      <Space size={4} wrap style={{ marginTop: 2 }}>
                        {h.workers.map((w) => (
                          <Tooltip key={w.workerId} title={`${w.pieces} pc by ${w.name}`}>
                            <Tag color="cyan" style={{ margin: 0 }}>
                              <Link to={`/manforce/workers/${w.workerId}`}>{w.name}</Link> · {w.pieces}
                            </Tag>
                          </Tooltip>
                        ))}
                        {h.labourValue > 0 && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            earned {money(h.labourValue, '₹', 0)}
                          </Text>
                        )}
                      </Space>
                    )}
                    {h.photos.length > 0 && (
                      <Image.PreviewGroup>
                        <Space size={6} wrap style={{ marginTop: 4 }}>
                          {h.photos.map((p) => (
                            <Image key={p.id} src={p.url} width={52} height={52} style={{ objectFit: 'cover', borderRadius: 4, border: '1px solid #eee' }} />
                          ))}
                        </Space>
                      </Image.PreviewGroup>
                    )}
                    {i === 0 && editable && (
                      <Popconfirm
                        title="Undo this movement?"
                        description="The pieces go back where they came from, and its photos are deleted."
                        onConfirm={() => undoMove.mutate(h.id)}
                        okButtonProps={{ danger: true }}
                      >
                        <Button size="small" type="text" danger icon={<UndoOutlined />} loading={undoMove.isPending}>
                          Undo
                        </Button>
                      </Popconfirm>
                    )}
                  </div>
                ),
              }))}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
