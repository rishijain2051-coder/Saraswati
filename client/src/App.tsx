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
import OperationsHome from './pages/operations/OperationsHome';
import OrdersPage from './pages/operations/OrdersPage';
import OrderEditPage from './pages/operations/OrderEditPage';
import OrderDetailPage from './pages/operations/OrderDetailPage';
import ProformasPage from './pages/operations/ProformasPage';
import ProformaEditPage from './pages/operations/ProformaEditPage';
import ProformaDetailPage from './pages/operations/ProformaDetailPage';
import SuppliersPage from './pages/operations/SuppliersPage';
import StockPage from './pages/operations/StockPage';
import DeliveryTracker from './pages/operations/DeliveryTracker';
import SheetsPage from './pages/operations/SheetsPage';
import SheetDetailPage from './pages/operations/SheetDetailPage';
import PaymentsPage from './pages/operations/PaymentsPage';
import PartyStatementPage from './pages/operations/PartyStatementPage';
import ManforceHome from './pages/manforce/ManforceHome';
import WorkersPage from './pages/manforce/WorkersPage';
import WorkerDetailPage from './pages/manforce/WorkerDetailPage';
import MusterPage from './pages/manforce/MusterPage';
import WagesPage from './pages/manforce/WagesPage';
import StatutoryPage from './pages/manforce/StatutoryPage';
import { ShoppingOutlined } from '@ant-design/icons';

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

        {/* Operations (Phase 2) */}
        <Route path="operations" element={<OperationsHome />} />
        <Route path="operations/orders" element={<OrdersPage />} />
        <Route path="operations/orders/new" element={<OrderEditPage />} />
        <Route path="operations/orders/:id" element={<OrderDetailPage />} />
        <Route path="operations/orders/:id/edit" element={<OrderEditPage />} />
        <Route path="operations/proformas" element={<ProformasPage />} />
        <Route path="operations/proformas/new" element={<ProformaEditPage />} />
        <Route path="operations/proformas/:id" element={<ProformaDetailPage />} />
        <Route path="operations/proformas/:id/edit" element={<ProformaEditPage />} />
        <Route path="operations/suppliers" element={<SuppliersPage />} />
        <Route path="operations/stock" element={<StockPage />} />
        <Route path="operations/delivery" element={<DeliveryTracker />} />
        <Route path="operations/sheets" element={<SheetsPage />} />
        <Route path="operations/sheets/:id" element={<SheetDetailPage />} />
        <Route path="operations/payments" element={<PaymentsPage />} />
        <Route path="operations/payments/:partyType/:partyId" element={<PartyStatementPage />} />

        {/* Manforce (Phase 3) */}
        <Route path="manforce" element={<ManforceHome />} />
        <Route path="manforce/workers" element={<WorkersPage />} />
        <Route path="manforce/workers/:id" element={<WorkerDetailPage />} />
        <Route path="manforce/muster" element={<MusterPage />} />
        <Route path="manforce/wages" element={<WagesPage />} />
        <Route path="manforce/statutory" element={<StatutoryPage />} />

        {/* Placeholder modules (future phases) */}
        <Route path="sales" element={<PlaceholderModule title="Finished Product & Sales Management" icon={<ShoppingOutlined />} />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
