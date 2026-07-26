import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';

export default function PlaceholderModule({ title, icon }: { title: string; icon?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <Result
      icon={<div style={{ fontSize: 56, color: '#bcaaa4' }}>{icon}</div>}
      title={title}
      subTitle="This module is planned for a later phase. Product Management is live now, and its data (costing, dimensions, volumes) is being built to feed straight into Operations and Sales."
      extra={
        <Button type="primary" onClick={() => navigate('/products')}>
          Go to Product Management
        </Button>
      }
    />
  );
}
