import { Card, Col, Divider, Row, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMeta } from '../api/hooks';
import { headColor, money, num, formatUpdated } from '../util/format';
import type { CostLine, CostSheet } from '../api/types';

const { Text, Title } = Typography;

const HEAD_ORDER = ['MAIN_COMPONENT', 'SUB_COMPONENT', 'HARDWARE', 'POLISHING', 'PACKAGING', 'LABOUR', 'FORWARDING'];

function dimText(line: CostLine, method: string): string {
  if (method === 'WEIGHT') return line.actualWeight != null ? `${num(line.actualWeight, 3)} kg` : '—';
  const parts = [line.costL, line.costW, line.costH].filter((v) => v != null) as number[];
  if (!parts.length) return '—';
  return parts.map((v) => num(v, 2)).join(' × ');
}

export default function CostingSheetView({ sheet, symbol = '₹' }: { sheet: CostSheet; symbol?: string }) {
  const { data: meta } = useMeta();
  const headLabel = (h: string) => meta?.heads.find((x) => x.code === h)?.label ?? h;
  const measureUnit = (method: string) => meta?.methods.find((m) => m.code === method)?.measureUnit ?? '';
  const summary = sheet.summary;

  const lineColumns = (method: string): ColumnsType<CostLine> => [
    { title: 'Item', dataIndex: 'name', render: (v) => <Text strong>{v}</Text> },
    { title: 'Dimensions', key: 'dims', render: (_, r) => <Text type="secondary">{dimText(r, method)}</Text> },
    { title: 'Qty', dataIndex: 'qty', align: 'right', render: (v) => num(v, 2) },
    { title: 'Waste %', dataIndex: 'wastagePct', align: 'right', render: (v) => (v ? `${num(v, 2)}%` : '—') },
    { title: `Measure (${measureUnit(method)})`, dataIndex: 'measure', align: 'right', render: (v) => num(v, 4) },
    { title: 'Rate', dataIndex: 'rate', align: 'right', render: (v) => money(v, symbol) },
    { title: 'Amount', dataIndex: 'amount', align: 'right', render: (v) => <Text strong>{money(v, symbol)}</Text> },
  ];

  const groupsByHead = HEAD_ORDER.map((head) => ({
    head,
    groups: (sheet.groups || []).filter((g) => g.head === head).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
  })).filter((h) => h.groups.length > 0);

  return (
    <Row gutter={16}>
      <Col xs={24} lg={16}>
        {groupsByHead.map(({ head, groups }) => {
          const headTotal = summary?.headTotals[head] ?? groups.reduce((s, g) => s + (g.total ?? 0), 0);
          return (
            <div key={head} style={{ marginBottom: 20 }}>
              <div className="cost-head-bar" style={{ background: headColor(head), display: 'flex', justifyContent: 'space-between' }}>
                <span>{headLabel(head)}</span>
                <span>{money(headTotal, symbol)}</span>
              </div>
              {groups.map((g) => (
                <Card key={g.id ?? g.name} size="small" style={{ marginTop: 10 }}
                  title={<span>{g.name} <Tag color="default" style={{ marginLeft: 6 }}>{measureUnit(g.method) || g.method}</Tag></span>}
                  extra={<Text strong>{money(g.total, symbol)}</Text>}
                >
                  <Table<CostLine>
                    rowKey={(r) => String(r.id ?? r.name)}
                    size="small"
                    pagination={false}
                    columns={lineColumns(g.method)}
                    dataSource={g.lines}
                  />
                </Card>
              ))}
            </div>
          );
        })}
      </Col>

      <Col xs={24} lg={8}>
        <Card style={{ position: 'sticky', top: 12 }}>
          <Title level={4} style={{ marginTop: 0, marginBottom: 2 }}>Cost Summary</Title>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
            Prices last updated: {formatUpdated(sheet.updatedAt)}
          </Text>
          {summary && (
            <>
              <Row justify="space-between"><Text>Ex-Factory Cost</Text><Text strong>{money(summary.exFactory, symbol)}</Text></Row>
              <Row justify="space-between" style={{ marginTop: 6 }}><Text>Forwarding</Text><Text>{money(summary.forwarding, symbol)}</Text></Row>
              <Row justify="space-between" style={{ marginTop: 6 }}><Text>Factory Expenses ({num(summary.factoryExpensePct, 2)}%)</Text><Text>{money(summary.factoryExpense, symbol)}</Text></Row>
              <Row justify="space-between" style={{ marginTop: 6 }}><Text>Margin ({num(summary.marginPct, 2)}%)</Text><Text>{money(summary.margin, symbol)}</Text></Row>
              <Divider style={{ margin: '12px 0' }} />
              <Row justify="space-between" align="middle">
                <Title level={4} style={{ margin: 0 }}>FOB Cost</Title>
                <Title level={3} style={{ margin: 0, color: '#4e342e' }}>{money(summary.fob, symbol)}</Title>
              </Row>
              <Row justify="space-between" style={{ marginTop: 10 }}>
                <Text type="secondary">Non-FOB (Ex-Works)</Text>
                <Text strong>{money(summary.nonFob, symbol)}</Text>
              </Row>
              <Divider style={{ margin: '12px 0' }} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                Per piece. Forwarding is excluded from Ex-Factory; Factory Expense & Margin apply cumulatively. Non-FOB removes forwarding entirely.
              </Text>
            </>
          )}
        </Card>
      </Col>
    </Row>
  );
}
