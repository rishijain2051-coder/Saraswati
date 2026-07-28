import { Breadcrumb, Result } from 'antd';
import { HomeOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';

export default function OpsPlaceholder({ title }: { title: string }) {
  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          { title: <Link to="/"><HomeOutlined /></Link> },
          { title: <Link to="/operations">Operations</Link> },
          { title },
        ]}
      />
      <Result status="info" title={title} subTitle="This Operations section is being built — coming shortly in this phase." />
    </div>
  );
}
