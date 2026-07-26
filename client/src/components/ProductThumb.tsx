import { AppstoreOutlined } from '@ant-design/icons';

export default function ProductThumb({ url, size = 44 }: { url?: string | null; size?: number }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        style={{ width: size, height: size, objectFit: 'cover', borderRadius: 6, border: '1px solid #eee' }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        background: '#efebe9',
        display: 'grid',
        placeItems: 'center',
        color: '#bcaaa4',
      }}
    >
      <AppstoreOutlined />
    </div>
  );
}
