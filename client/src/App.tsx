import { Navigate, Route, Routes } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from './auth/AuthContext';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import PlaceholderModule from './pages/PlaceholderModule';
import ProductModuleHome from './pages/product/ProductModuleHome';
import ProductCataloguePage from './pages/product/ProductCataloguePage';
import ProductListPage from './pages/product/ProductListPage';
import ProductDetailPage from './pages/product/ProductDetailPage';
import ProductWizardPage from './pages/product/ProductWizardPage';
import MastersPage from './pages/settings/MastersPage';
import UsersPage from './pages/settings/UsersPage';
import {
  TeamOutlined,
  InboxOutlined,
  ToolOutlined,
  ShoppingOutlined,
} from '@ant-design/icons';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />

        {/* Product Management (Phase 1) */}
        <Route path="products" element={<ProductModuleHome />} />
        <Route path="products/catalogue" element={<ProductCataloguePage />} />
        <Route path="products/catalogue/:id" element={<ProductDetailPage catalogueMode />} />
        <Route path="products/list" element={<ProductListPage />} />
        <Route path="products/new" element={<ProductWizardPage />} />
        <Route path="products/:id" element={<ProductDetailPage />} />
        <Route path="products/:id/edit" element={<ProductWizardPage />} />

        {/* Settings */}
        <Route path="settings/masters" element={<MastersPage />} />
        <Route path="settings/users" element={<UsersPage />} />

        {/* Placeholder modules (future phases) */}
        <Route
          path="manforce"
          element={<PlaceholderModule title="Manforce Management" icon={<TeamOutlined />} />}
        />
        <Route
          path="raw-material"
          element={<PlaceholderModule title="Raw Material Management" icon={<InboxOutlined />} />}
        />
        <Route
          path="operations"
          element={<PlaceholderModule title="Operations Management" icon={<ToolOutlined />} />}
        />
        <Route
          path="sales"
          element={<PlaceholderModule title="Finished Product & Sales Management" icon={<ShoppingOutlined />} />}
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
