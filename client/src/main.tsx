import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import AppRoutes from './App';
import { AuthProvider } from './auth/AuthContext';
import 'antd/dist/reset.css';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#6d4c41',
          colorLink: '#6d4c41',
          borderRadius: 8,
          fontSize: 14,
        },
        components: {
          Layout: { headerBg: '#4e342e', siderBg: '#3e2723' },
          Menu: { darkItemBg: '#3e2723', darkItemSelectedBg: '#6d4c41' },
        },
      }}
    >
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
);
