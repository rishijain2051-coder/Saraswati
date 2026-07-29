import { useState } from 'react';
import { App, Layout, Menu, Avatar, Dropdown, Typography, Tag, Modal, Form, Input } from 'antd';
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
  KeyOutlined,
  UserOutlined,
  ProfileOutlined,
  TableOutlined,
  DashboardOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  ShopOutlined,
  WalletOutlined,
  CalendarOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiError } from '../api/client';

const { Header, Sider, Content } = Layout;

export default function AppLayout() {
  const { user, logout, hasRole, changePassword } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [pwOpen, setPwOpen] = useState(false);
  const [pwForm] = Form.useForm();
  const [pwSaving, setPwSaving] = useState(false);

  const submitPassword = async (v: { currentPassword: string; newPassword: string }) => {
    setPwSaving(true);
    try {
      await changePassword(v.currentPassword, v.newPassword);
      message.success('Password changed.');
      setPwOpen(false);
      pwForm.resetFields();
    } catch (e) {
      message.error(apiError(e));
    } finally {
      setPwSaving(false);
    }
  };

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
    {
      key: 'manforce',
      icon: <TeamOutlined />,
      label: 'Manforce',
      children: [
        { key: '/manforce', icon: <DashboardOutlined />, label: <Link to="/manforce">Dashboard</Link> },
        { key: '/manforce/workers', icon: <TeamOutlined />, label: <Link to="/manforce/workers">Workers</Link> },
        { key: '/manforce/muster', icon: <CalendarOutlined />, label: <Link to="/manforce/muster">Muster Roll</Link> },
        { key: '/manforce/wages', icon: <WalletOutlined />, label: <Link to="/manforce/wages">Wages</Link> },
        ...(hasRole('Manager') ? [{ key: '/manforce/statutory', icon: <SafetyCertificateOutlined />, label: <Link to="/manforce/statutory">Statutory</Link> }] : []),
      ],
    },
    {
      key: 'operations',
      icon: <ToolOutlined />,
      label: 'Operations',
      children: [
        { key: '/operations', icon: <DashboardOutlined />, label: <Link to="/operations">Dashboard</Link> },
        { key: '/operations/proformas', icon: <FileTextOutlined />, label: <Link to="/operations/proformas">Proformas</Link> },
        { key: '/operations/orders', icon: <FileDoneOutlined />, label: <Link to="/operations/orders">Orders</Link> },
        { key: '/operations/delivery', icon: <CalendarOutlined />, label: <Link to="/operations/delivery">Delivery</Link> },
        { key: '/operations/sheets', icon: <ProfileOutlined />, label: <Link to="/operations/sheets">Material Sheets</Link> },
        { key: '/operations/suppliers', icon: <ShopOutlined />, label: <Link to="/operations/suppliers">Suppliers</Link> },
        { key: '/operations/stock', icon: <InboxOutlined />, label: <Link to="/operations/stock">Stock</Link> },
        { key: '/operations/payments', icon: <WalletOutlined />, label: <Link to="/operations/payments">Payments</Link> },
      ],
    },
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
    // Operations sub-sections — match the deepest section key.
    for (const seg of ['orders', 'proformas', 'suppliers', 'stock', 'sheets', 'payments']) {
      if (p.startsWith(`/operations/${seg}`)) return [`/operations/${seg}`];
    }
    if (p === '/operations') return ['/operations'];
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
              { key: 'password', icon: <KeyOutlined />, label: 'Change password', onClick: () => setPwOpen(true) },
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
          <Menu theme="dark" mode="inline" selectedKeys={selected} defaultOpenKeys={['products', 'manforce', 'operations']} items={items} style={{ paddingTop: 8 }} />
        </Sider>
        <Content style={{ padding: 24, overflow: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>

      <Modal title="Change password" open={pwOpen} onCancel={() => setPwOpen(false)} onOk={() => pwForm.submit()} confirmLoading={pwSaving} okText="Change" destroyOnHidden>
        <Form form={pwForm} layout="vertical" onFinish={submitPassword} style={{ marginTop: 12 }}>
          <Form.Item name="currentPassword" label="Current password" rules={[{ required: true, message: 'Enter your current password.' }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item name="newPassword" label="New password" rules={[{ required: true, min: 8, message: 'Use at least 8 characters.' }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirm"
            label="Confirm new password"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: 'Type it again.' },
              ({ getFieldValue }) => ({
                validator: (_, v) => (!v || v === getFieldValue('newPassword') ? Promise.resolve() : Promise.reject(new Error('The two passwords do not match.'))),
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}
