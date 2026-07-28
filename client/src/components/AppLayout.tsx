import { Layout, Menu, Avatar, Dropdown, Typography, Tag } from 'antd';
import {
  HomeOutlined,
  AppstoreOutlined,
  TeamOutlined,
  InboxOutlined,
  ToolOutlined,
  ShoppingOutlined,
  SettingOutlined,
  UsergroupAddOutlined,
  LogoutOutlined,
  UserOutlined,
  ProfileOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const { Header, Sider, Content } = Layout;

export default function AppLayout() {
  const { user, logout, hasRole } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const items = [
    { key: '/', icon: <HomeOutlined />, label: <Link to="/">Home</Link> },
    {
      key: 'products',
      icon: <AppstoreOutlined />,
      label: 'Product Management',
      children: [
        { key: '/products/catalogue', icon: <ProfileOutlined />, label: <Link to="/products/catalogue">Product Catalogue</Link> },
        { key: '/products/list', icon: <TableOutlined />, label: <Link to="/products/list">Product Details</Link> },
      ],
    },
    { key: '/manforce', icon: <TeamOutlined />, label: <Link to="/manforce">Manforce</Link> },
    { key: '/raw-material', icon: <InboxOutlined />, label: <Link to="/raw-material">Raw Material</Link> },
    { key: '/operations', icon: <ToolOutlined />, label: <Link to="/operations">Operations</Link> },
    { key: '/sales', icon: <ShoppingOutlined />, label: <Link to="/sales">Finished & Sales</Link> },
    ...(hasRole('Manager')
      ? [{ key: '/settings/masters', icon: <SettingOutlined />, label: <Link to="/settings/masters">Master Data</Link> }]
      : []),
    ...(hasRole('Admin')
      ? [{ key: '/settings/users', icon: <UsergroupAddOutlined />, label: <Link to="/settings/users">Users</Link> }]
      : []),
  ];

  const selected = (() => {
    const p = location.pathname;
    if (p.startsWith('/products/catalogue')) return ['/products/catalogue'];
    if (p.startsWith('/products')) return ['/products/list'];
    if (p.startsWith('/settings/masters')) return ['/settings/masters'];
    return [p];
  })();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingInline: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 22 }}>🪵</div>
          <span className="brand-title" style={{ fontSize: 18 }}>
            Saraswati Export <span style={{ opacity: 0.7, fontWeight: 400 }}>· ERP</span>
          </span>
        </div>
        <Dropdown
          menu={{
            items: [
              { key: 'role', disabled: true, label: <Tag color="#6d4c41">{user?.role}</Tag> },
              { type: 'divider' },
              { key: 'logout', icon: <LogoutOutlined />, label: 'Sign out', onClick: () => { logout(); navigate('/login'); } },
            ],
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#fff' }}>
            <Avatar style={{ background: '#a1887f' }} icon={<UserOutlined />} />
            <span>{user?.name}</span>
          </div>
        </Dropdown>
      </Header>
      <Layout>
        <Sider width={230} breakpoint="lg" collapsedWidth={0} theme="dark">
          <Menu theme="dark" mode="inline" selectedKeys={selected} defaultOpenKeys={['products']} items={items} style={{ paddingTop: 8 }} />
        </Sider>
        <Content style={{ padding: 24, overflow: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
