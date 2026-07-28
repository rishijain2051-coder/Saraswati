import { useEffect } from 'react';
import { Alert, App, Button, Checkbox, Col, DatePicker, Divider, Drawer, Form, Input, InputNumber, Row, Select, Space, Switch, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, apiError } from '../../api/client';
import { MANFORCE_KEYS, PAY_TYPES, PAY_TYPE_HINT, PAY_TYPE_LABEL, useContractors, useStatutoryComponents, useTrades, useWorker, type Worker } from '../../api/manforce';
import { RateHint } from '../../components/HistoryHint';

const { Text } = Typography;

/**
 * Add or edit a worker.
 *
 * The pay type decides which rate matters, and the server refuses a type without its
 * rate — a day-wage worker with no daily rate would silently accrue nothing forever.
 */
export default function WorkerFormDrawer({ open, worker, onClose }: { open: boolean; worker: Worker | null; onClose: () => void }) {
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { data: trades } = useTrades();
  const { data: contractors } = useContractors();
  const { data: components } = useStatutoryComponents();
  // The list response does not carry coverage, so read the full record when editing.
  const { data: full } = useWorker(open && worker ? worker.id : undefined);

  const payType = Form.useWatch('payType', form) ?? 'DAY';
  // A rate has no history of its own until it is changed, so what helps is what the
  // trade is actually being paid right now.
  const tradeId = Form.useWatch('tradeId', form) as number | undefined;
  const dailyRate = Form.useWatch('dailyRate', form) as number | undefined;
  const monthlySalary = Form.useWatch('monthlySalary', form) as number | undefined;

  useEffect(() => {
    if (!open) return;
    const w = full ?? worker;
    form.setFieldsValue({
      payType: w?.payType ?? 'DAY',
      name: w?.name ?? '',
      code: w?.code ?? '',
      tradeId: w?.tradeId ?? null,
      contractorId: w?.contractorId ?? null,
      dailyRate: w?.dailyRate ?? 0,
      otHourlyRate: w?.otHourlyRate ?? 0,
      monthlySalary: w?.monthlySalary ?? 0,
      joinedOn: w?.joinedOn ? dayjs(w.joinedOn) : dayjs(),
      exitOn: w?.exitOn ? dayjs(w.exitOn) : null,
      exitReason: w?.exitReason ?? '',
      isActive: w?.isActive ?? true,
      phone: w?.phone ?? '',
      altPhone: w?.altPhone ?? '',
      address: w?.address ?? '',
      guardianName: w?.guardianName ?? '',
      emergencyName: w?.emergencyName ?? '',
      emergencyPhone: w?.emergencyPhone ?? '',
      dateOfBirth: w?.dateOfBirth ? dayjs(w.dateOfBirth) : null,
      gender: w?.gender ?? null,
      aadhaarNo: w?.aadhaarNo ?? '',
      panNo: w?.panNo ?? '',
      uanNo: w?.uanNo ?? '',
      esicNo: w?.esicNo ?? '',
      bankName: w?.bankName ?? '',
      bankAccountNo: w?.bankAccountNo ?? '',
      bankIfsc: w?.bankIfsc ?? '',
      upiId: w?.upiId ?? '',
      notes: w?.notes ?? '',
      statutoryComponentIds: full?.statutory?.filter((s) => s.covered).map((s) => s.componentId) ?? [],
    });
  }, [open, worker, full, form]);

  const save = useMutation({
    mutationFn: async (values: any) => {
      const body = {
        ...values,
        code: values.code?.trim() || undefined,
        joinedOn: values.joinedOn ? values.joinedOn.toISOString() : undefined,
        exitOn: values.exitOn ? values.exitOn.toISOString() : null,
        dateOfBirth: values.dateOfBirth ? values.dateOfBirth.toISOString() : null,
      };
      return worker ? api.patch(`/workers/${worker.id}`, body) : api.post('/workers', body);
    },
    onSuccess: () => {
      message.success(worker ? 'Worker updated.' : 'Worker added.');
      for (const key of MANFORCE_KEYS) qc.invalidateQueries({ queryKey: key });
      onClose();
    },
    onError: (e) => message.error(apiError(e)),
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={720}
      title={worker ? `${worker.name} · ${worker.code}` : 'Add a worker'}
      extra={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" loading={save.isPending} onClick={() => form.submit()}>
            Save
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Who is this?' }]}>
              <Input placeholder="Ramesh Kumar" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="code" label="Code" tooltip="Left empty, the next WRK number is allocated.">
              <Input placeholder="auto" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="isActive" label="On the books" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col span={8}>
            <Form.Item name="tradeId" label="Trade">
              <Select allowClear placeholder="Carpenter…" options={(trades ?? []).filter((t) => t.isActive).map((t) => ({ value: t.id, label: t.name }))} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name="contractorId"
              label="Paid through"
              tooltip="Leave empty for a worker the factory pays directly. In a gang, their earnings roll up into the contractor's balance."
            >
              <Select allowClear placeholder="the factory" options={(contractors ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: c.name }))} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="joinedOn" label="Joined on" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} format="DD MMM YYYY" />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left" plain>
          How they are paid
        </Divider>
        <Form.Item name="payType" label="Paid by" extra={PAY_TYPE_HINT[payType as keyof typeof PAY_TYPE_HINT]}>
          <Select options={PAY_TYPES.map((t) => ({ value: t, label: PAY_TYPE_LABEL[t] }))} />
        </Form.Item>
        <Row gutter={12}>
          {payType === 'DAY' && (
            <Col span={8}>
              <Form.Item
                name="dailyRate"
                label="Daily rate (₹)"
                rules={[{ required: true, message: 'Needed for a day-wage worker.' }]}
                extra={<RateHint compact={false} kind="WORKER" tradeId={tradeId} payType="DAY" value={dailyRate} unitSuffix="/day" onApply={(v) => form.setFieldsValue({ dailyRate: v })} />}
              >
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          )}
          {payType === 'MONTHLY' && (
            <Col span={8}>
              <Form.Item
                name="monthlySalary"
                label="Monthly salary (₹)"
                rules={[{ required: true, message: 'Needed for a salaried worker.' }]}
                extra={<RateHint compact={false} kind="WORKER" tradeId={tradeId} payType="MONTHLY" value={monthlySalary} unitSuffix="/month" onApply={(v) => form.setFieldsValue({ monthlySalary: v })} />}
              >
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          )}
          {payType === 'PIECE' && (
            <Col span={16}>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="Paid off the board"
                description="Their earnings come from the pieces they clear, at the rate on that stage of the order. Attendance never pays them, so marking them present is only a record of presence."
              />
            </Col>
          )}
          {payType !== 'PIECE' && (
            <Col span={8}>
              <Form.Item name="otHourlyRate" label="Overtime (₹/hour)" tooltip="Left at zero, it is worked out from the day's pay and the OT multiplier in Master Data.">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          )}
        </Row>

        <Divider orientation="left" plain>
          Statutory cover
        </Divider>
        <Form.Item name="statutoryComponentIds" extra="Only the levies ticked here are computed for this worker. Casual labour is usually in none of them.">
          <Checkbox.Group
            options={(components ?? [])
              .filter((c) => c.isActive)
              .map((c) => ({ value: c.id, label: `${c.code} — ${c.name}${c.isProvision ? ' (provision)' : ''}` }))}
          />
        </Form.Item>

        <Divider orientation="left" plain>
          Contact
        </Divider>
        <Row gutter={12}>
          <Col span={8}>
            <Form.Item name="phone" label="Phone">
              <Input />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="altPhone" label="Alternate phone">
              <Input />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="dateOfBirth" label="Date of birth">
              <DatePicker style={{ width: '100%' }} format="DD MMM YYYY" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="guardianName" label="Father / guardian">
              <Input />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="emergencyName" label="Emergency contact">
              <Input />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="emergencyPhone" label="Emergency phone">
              <Input />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name="address" label="Address">
              <Input.TextArea rows={2} />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left" plain>
          Identity and payout
        </Divider>
        <Text type="secondary">Only a Manager or Admin can see these.</Text>
        <Row gutter={12} style={{ marginTop: 12 }}>
          <Col span={6}>
            <Form.Item name="aadhaarNo" label="Aadhaar">
              <Input />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="panNo" label="PAN">
              <Input />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="uanNo" label="UAN (PF)">
              <Input />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="esicNo" label="ESIC number">
              <Input />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="bankName" label="Bank">
              <Input />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="bankAccountNo" label="Account number">
              <Input />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="bankIfsc" label="IFSC">
              <Input />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="upiId" label="UPI">
              <Input />
            </Form.Item>
          </Col>
        </Row>

        {worker && (
          <>
            <Divider orientation="left" plain>
              Leaving
            </Divider>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="exitOn" label="Left on" tooltip="Nothing accrues after this date.">
                  <DatePicker style={{ width: '100%' }} format="DD MMM YYYY" />
                </Form.Item>
              </Col>
              <Col span={16}>
                <Form.Item name="exitReason" label="Reason">
                  <Input />
                </Form.Item>
              </Col>
            </Row>
          </>
        )}

        <Form.Item name="notes" label="Notes">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
