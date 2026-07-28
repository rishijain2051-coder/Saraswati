import { Breadcrumb, Card, Col, List, Row, Statistic, Tag, Typography } from 'antd';
import {
  HomeOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  ShopOutlined,
  InboxOutlined,
  ProfileOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { useOpsDashboard } from '../../api/ops';
import { num } from '../../util/format';

const { Title, Text } = Typography;

const SECTIONS = [
  { key: 'orders', title: 'Orders', icon: <FileDoneOutlined />, path: '/operations/orders', desc: 'Buyer orders from proforma to shipment.' },
  { key: 'proformas', title: 'Proformas', icon: <FileTextOutlined />, path: '/operations/proformas', desc: 'Proforma invoices & their status.' },
  { key: 'suppliers', title: 'Suppliers', icon: <ShopOutlined />, path: '/operations/suppliers', desc: 'Material & jobwork vendors.' },
  { key: 'stock', title: 'Stock', icon: <InboxOutlined />, path: '/operations/stock', desc: 'Raw-material inward, outward & balances.' },
  { key: 'sheets', title: 'Operation Sheets', icon: <ProfileOutlined />, path: '/operations/sheets', desc: 'Material & labour sheets, stages & jobwork.' },
  { key: 'payments', title: 'Payments', icon: <WalletOutlined />, path: '/operations/payments', desc: 'Ledgers & dues for suppliers, buyers, workers.' },
];

export default function OperationsHome() {
  const navigate = useNavigate();
  const { data: d } = useOpsDashboard();

  return (
    <div>
      <Breadcrumb style={{ marginBottom: 16 }} items={[{ title: <Link to="/"><HomeOutlined /></Link> }, { title: 'Operations' }]} />
      <Title level={2} style={{ marginBottom: 2 }}>Operations</Title>
      <Text type="secondary">Your work hub — orders, proformas, suppliers, stock, operation sheets, jobs & payments.</Text>

      <Row gutter={[16, 16]} style={{ margin: '16px 0' }}>
        <Col xs={12} md={6}><Card size="small" hoverable onClick={() => navigate('/operations/orders')}><Statistic title="Pending Orders" value={d?.pendingOrders ?? 0} /></Card></Col>
        <Col xs={12} md={6}><Card size="small" hoverable onClick={() => navigate('/operations/sheets')}><Statistic title="Jobs In Production" value={d?.inProduction ?? 0} /></Card></Col>
        <Col xs={12} md={6}><Card size="small" hoverable onClick={() => navigate('/operations/payments')}><Statistic title="Receivable (₹)" value={num(d?.receivable ?? 0, 0)} valueStyle={{ color: '#389e0d' }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small" hoverable onClick={() => navigate('/operations/payments')}><Statistic title="Payable (₹)" value={num(d?.payable ?? 0, 0)} valueStyle={{ color: '#cf1322' }} /></Card></Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12}>
          <Card size="small" title="Recent proformas">
            <List
              size="small"
              dataSource={d?.recentProformas ?? []}
              locale={{ emptyText: 'No proformas yet' }}
              renderItem={(p) => (
                <List.Item onClick={() => navigate(`/operations/proformas/${p.id}`)} style={{ cursor: 'pointer' }}>
                  <span><b>{p.number}</b> · {p.buyer}</span>
                  <span><Tag>{p.status}</Tag><Text type="secondary">{dayjs(p.date).format('DD MMM')}</Text></span>
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card size="small" title="Low stock alerts">
            <List
              size="small"
              dataSource={d?.lowStock ?? []}
              locale={{ emptyText: 'All stock above reorder level' }}
              renderItem={(it) => (
                <List.Item onClick={() => navigate('/operations/stock')} style={{ cursor: 'pointer' }}>
                  <span>{it.name}</span>
                  <span><Tag color="red">{num(it.balance, 2)} {it.unit}</Tag><Text type="secondary">reorder ≤ {num(it.reorderLevel, 0)}</Text></span>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        {SECTIONS.map((s) => (
          <Col key={s.key} xs={24} sm={12} lg={8}>
            <Card className="module-card" onClick={() => navigate(s.path)} style={{ height: '100%', borderTop: '4px solid #6d4c41' }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div style={{ fontSize: 30, color: '#6d4c41' }}>{s.icon}</div>
                <div><Title level={4} style={{ margin: 0 }}>{s.title}</Title><Text type="secondary">{s.desc}</Text></div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
