import { Card, Col, Row, Typography, Tag } from 'antd';
import {
  TeamOutlined,
  AppstoreOutlined,
  ToolOutlined,
  ShoppingOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const { Title, Text } = Typography;

const MODULES = [
  { key: 'manforce', title: 'Manforce Management', icon: <TeamOutlined />, path: '/manforce', ready: false, desc: 'Workers, attendance, wages & productivity.' },
  { key: 'product', title: 'Product Management', icon: <AppstoreOutlined />, path: '/products', ready: true, desc: 'Catalogue, product details & costing sheets.' },
  { key: 'operations', title: 'Operations Management', icon: <ToolOutlined />, path: '/operations', ready: true, desc: 'Orders, proformas, suppliers, stock, operation sheets, jobs & payments.' },
  { key: 'sales', title: 'Finished Product & Sales', icon: <ShoppingOutlined />, path: '/sales', ready: false, desc: 'Finished goods, dispatch, containers & sales.' },
];

export default function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Title level={2} style={{ marginBottom: 4 }}>
          Welcome, {user?.name?.split(' ')[0]} 👋
        </Title>
        <Text type="secondary">Choose a module to begin.</Text>
      </div>
      <Row gutter={[20, 20]}>
        {MODULES.map((m) => (
          <Col key={m.key} xs={24} sm={12} lg={8}>
            <Card
              className="module-card"
              onClick={() => navigate(m.path)}
              style={{ height: '100%', borderTop: `4px solid ${m.ready ? '#6d4c41' : '#d7ccc8'}` }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ fontSize: 34, color: m.ready ? '#6d4c41' : '#bcaaa4' }}>{m.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Title level={4} style={{ margin: 0 }}>
                      {m.title}
                    </Title>
                    {m.ready ? <Tag color="green">Live</Tag> : <Tag>Soon</Tag>}
                  </div>
                  <Text type="secondary">{m.desc}</Text>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
