import { Button, Card, Col, Empty, Input, Row, Select, Space, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useMeta, useProducts } from '../../../api/hooks';
import type { WizardDraft } from './draft';

const { Text } = Typography;

export default function StepRelated({
  draft,
  set,
  currentId,
}: {
  draft: WizardDraft;
  set: (patch: Partial<WizardDraft>) => void;
  currentId?: number;
}) {
  const { data: meta } = useMeta();
  const { data: products } = useProducts({});

  const productOpts = (products ?? [])
    .filter((p) => p.id !== currentId)
    .map((p) => ({ label: `${p.factoryCode} — ${p.name}`, value: p.id }));

  const add = () => set({ related: [...draft.related, { relatedId: undefined as unknown as number, relation: 'VARIANT', note: '' }] });

  return (
    <Card
      title="Related Products"
      extra={<Button icon={<PlusOutlined />} onClick={add}>Add related</Button>}
    >
      <Text type="secondary">Link variants, parts/components, accessories or items from the same set — useful for operations & sales later.</Text>
      <div style={{ marginTop: 16 }}>
        {draft.related.length === 0 ? (
          <Empty description="No related products linked" />
        ) : (
          <Space direction="vertical" style={{ width: '100%' }}>
            {draft.related.map((r, i) => (
              <Row gutter={8} key={i} align="middle">
                <Col xs={24} md={10}>
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder="Select product"
                    style={{ width: '100%' }}
                    value={r.relatedId ?? undefined}
                    options={productOpts}
                    onChange={(v) => {
                      const arr = [...draft.related];
                      arr[i] = { ...arr[i], relatedId: v };
                      set({ related: arr });
                    }}
                  />
                </Col>
                <Col xs={12} md={5}>
                  <Select
                    style={{ width: '100%' }}
                    value={r.relation}
                    options={(meta?.relationTypes ?? []).map((t) => ({ label: t.label, value: t.code }))}
                    onChange={(v) => {
                      const arr = [...draft.related];
                      arr[i] = { ...arr[i], relation: v };
                      set({ related: arr });
                    }}
                  />
                </Col>
                <Col xs={10} md={7}>
                  <Input
                    placeholder="Note (optional)"
                    value={r.note ?? ''}
                    onChange={(e) => {
                      const arr = [...draft.related];
                      arr[i] = { ...arr[i], note: e.target.value };
                      set({ related: arr });
                    }}
                  />
                </Col>
                <Col xs={2}>
                  <Button danger icon={<DeleteOutlined />} onClick={() => set({ related: draft.related.filter((_, j) => j !== i) })} />
                </Col>
              </Row>
            ))}
          </Space>
        )}
      </div>
    </Card>
  );
}
