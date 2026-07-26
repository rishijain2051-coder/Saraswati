import { Button, Card, Empty, Image, Space, Tag, Upload, App } from 'antd';
import { StarFilled, StarOutlined, DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../api/client';
import type { ProductImage } from '../api/types';

export default function ProductImages({
  productId,
  images,
  editable,
}: {
  productId: number;
  images: ProductImage[];
  editable: boolean;
}) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const refresh = () => qc.invalidateQueries({ queryKey: ['product', String(productId)] });

  const setPrimary = useMutation({
    mutationFn: (imageId: number) => api.patch(`/products/${productId}/images/${imageId}`, { isPrimary: true }),
    onSuccess: refresh,
    onError: (e) => message.error(apiError(e)),
  });
  const del = useMutation({
    mutationFn: (imageId: number) => api.delete(`/products/${productId}/images/${imageId}`),
    onSuccess: () => { message.success('Image removed.'); refresh(); },
    onError: (e) => message.error(apiError(e)),
  });

  return (
    <div>
      {editable && (
        <Upload
          multiple
          accept="image/*"
          showUploadList={false}
          customRequest={async ({ file, onSuccess, onError }) => {
            const form = new FormData();
            form.append('images', file as Blob);
            try {
              await api.post(`/products/${productId}/images`, form);
              onSuccess?.({});
              message.success('Image uploaded.');
              refresh();
            } catch (e) {
              onError?.(e as Error);
              message.error(apiError(e));
            }
          }}
        >
          <Button icon={<UploadOutlined />} style={{ marginBottom: 16 }}>
            Upload images
          </Button>
        </Upload>
      )}

      {images.length === 0 ? (
        <Empty description="No images yet" />
      ) : (
        <Image.PreviewGroup>
          <Space wrap size={16}>
            {images.map((img) => (
              <Card
                key={img.id}
                size="small"
                styles={{ body: { padding: 8 } }}
                style={{ width: 180, border: img.isPrimary ? '2px solid #6d4c41' : undefined }}
              >
                <Image src={img.url} width={162} height={140} style={{ objectFit: 'cover', borderRadius: 4 }} />
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  {img.isPrimary ? (
                    <Tag color="#6d4c41" icon={<StarFilled />}>Primary</Tag>
                  ) : editable ? (
                    <Button size="small" type="text" icon={<StarOutlined />} onClick={() => setPrimary.mutate(img.id)}>
                      Set primary
                    </Button>
                  ) : (
                    <span />
                  )}
                  {editable && <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={() => del.mutate(img.id)} />}
                </div>
              </Card>
            ))}
          </Space>
        </Image.PreviewGroup>
      )}
    </div>
  );
}
