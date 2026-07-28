import { Breadcrumb, Button, Result, Select, Skeleton, Space, Tag, Typography, App, Popconfirm } from 'antd';
import { HomeOutlined, ArrowLeftOutlined, PrinterOutlined, EditOutlined, SwapOutlined } from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, apiError } from '../../api/client';
import { useProforma, PROFORMA_STATUSES } from '../../api/ops';
import { useAuth } from '../../auth/AuthContext';
import { money } from '../../util/format';
import { PROFORMA_STATUS_COLOR } from './ProformasPage';

const { Title, Text } = Typography;

export default function ProformaDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { hasRole } = useAuth();
  const { data: p, isLoading, isError } = useProforma(id);

  const setStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/proformas/${id}/status`, { status }),
    onSuccess: () => { message.success('Status updated.'); qc.invalidateQueries({ queryKey: ['proforma', id] }); qc.invalidateQueries({ queryKey: ['proformas'] }); },
    onError: (e) => message.error(apiError(e)),
  });
  const convert = useMutation({
    mutationFn: () => api.post(`/proformas/${id}/convert`, {}),
    onSuccess: (res) => { message.success('Converted to order.'); qc.invalidateQueries({ queryKey: ['orders'] }); navigate(`/operations/orders/${(res.data as any).id}`); },
    onError: (e) => message.error(apiError(e)),
  });

  if (isLoading) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (isError || !p) return <Result status="404" title="Proforma not found" extra={<Button onClick={() => navigate('/operations/proformas')}>Back</Button>} />;

  const symbol = p.currency?.symbol ?? '₹';

  return (
    <div>
      <div className="no-print">
        <Breadcrumb style={{ marginBottom: 16 }} items={[{ title: <Link to="/"><HomeOutlined /></Link> }, { title: <Link to="/operations">Operations</Link> }, { title: <Link to="/operations/proformas">Proformas</Link> }, { title: p.number }]} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <Space><Title level={3} style={{ margin: 0 }}>{p.number}</Title><Tag color={PROFORMA_STATUS_COLOR[p.status] ?? 'default'}>{p.status}</Tag>{p.order && <Tag color="green">Order {p.order.number}</Tag>}</Space>
          <Space wrap>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/operations/proformas')}>Back</Button>
            {hasRole('Operator') && <Select value={p.status} style={{ width: 130 }} onChange={(v) => setStatus.mutate(v)} options={PROFORMA_STATUSES.map((s) => ({ label: s, value: s }))} />}
            {hasRole('Operator') && !p.order && <Button icon={<EditOutlined />} onClick={() => navigate(`/operations/proformas/${p.id}/edit`)}>Edit</Button>}
            {hasRole('Operator') && !p.order && (
              <Popconfirm title="Convert this proforma to a confirmed order?" onConfirm={() => convert.mutate()}>
                <Button type="primary" icon={<SwapOutlined />} loading={convert.isPending}>Convert to Order</Button>
              </Popconfirm>
            )}
            <Button icon={<PrinterOutlined />} onClick={() => window.print()}>Print / PDF</Button>
          </Space>
        </div>
      </div>

      <div className="print-area">
        <div className="doc-sheet">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#4e342e' }}>Saraswati Export</div>
              <div style={{ color: '#777', fontSize: 12 }}>Furniture & Hardware Exporter · Jodhpur, India</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>PROFORMA INVOICE</div>
              <div>{p.number}</div>
              <div style={{ color: '#777' }}>{dayjs(p.date).format('DD MMM YYYY')}</div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20, gap: 24 }}>
            <div>
              <div style={{ color: '#777', fontSize: 12 }}>BUYER</div>
              <div style={{ fontWeight: 600 }}>{p.buyer.name}</div>
              {p.buyer.address && <div style={{ fontSize: 12, whiteSpace: 'pre-line' }}>{p.buyer.address}</div>}
              {p.buyer.country && <div style={{ fontSize: 12 }}>{p.buyer.country}</div>}
            </div>
            <div style={{ textAlign: 'right', fontSize: 12 }}>
              {p.incoterms && <div><b>Incoterms:</b> {p.incoterms}</div>}
              {p.validUntil && <div><b>Valid until:</b> {dayjs(p.validUntil).format('DD MMM YYYY')}</div>}
              <div><b>Currency:</b> {p.currency?.code ?? 'INR'}</div>
            </div>
          </div>

          <table className="doc-table">
            <thead>
              <tr><th style={{ width: 40 }}>#</th><th>Description</th><th style={{ width: 70, textAlign: 'right' }}>Qty</th><th style={{ width: 110, textAlign: 'right' }}>Unit Price</th><th style={{ width: 120, textAlign: 'right' }}>Amount</th></tr>
            </thead>
            <tbody>
              {p.lines.map((l, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{l.description}{l.product ? <span style={{ color: '#999' }}> ({l.product.factoryCode})</span> : null}</td>
                  <td style={{ textAlign: 'right' }}>{l.qty}</td>
                  <td style={{ textAlign: 'right' }}>{money(l.unitPrice, symbol)}</td>
                  <td style={{ textAlign: 'right' }}>{money(l.qty * l.unitPrice, symbol)}</td>
                </tr>
              ))}
              <tr><td colSpan={4} style={{ textAlign: 'right', fontWeight: 700 }}>Total</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(p.total, symbol)}</td></tr>
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20, gap: 24, fontSize: 12 }}>
            <div style={{ maxWidth: '55%' }}>
              {p.paymentTerms && <div><b>Payment:</b> {p.paymentTerms}</div>}
              {p.deliveryTerms && <div><b>Delivery:</b> {p.deliveryTerms}</div>}
              {p.notes && <div style={{ marginTop: 8, whiteSpace: 'pre-line' }}>{p.notes}</div>}
            </div>
            {p.bankDetails && (
              <div style={{ whiteSpace: 'pre-line', textAlign: 'right' }}>
                <div style={{ color: '#777' }}>BANK DETAILS</div>
                {p.bankDetails}
              </div>
            )}
          </div>
          <div style={{ marginTop: 28, textAlign: 'right', fontSize: 12 }}>
            <div style={{ marginTop: 30 }}>For Saraswati Export</div>
            <div style={{ color: '#777' }}>Authorised Signatory</div>
          </div>
        </div>
      </div>
    </div>
  );
}
