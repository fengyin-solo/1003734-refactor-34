import { computed, ref } from 'vue'

import {
  availableKinds,
  readDevices,
  submitWorkflow,
} from '@/api/communication-workflow'
import type { DeviceView } from '@/api/communication-workflow'
import { useSessionStore } from '@/stores/session'
import type { WorkflowKind, WorkflowResult } from '@/data/types'

/**
 * 通讯设备故障处理的统一入口：列表、详情、巡检链路共用。
 * 提交一律走 submitWorkflow，权限、去重、并发都在领域服务里裁决。
 */
export function useFaultWorkflow(source: string, onChanged: () => void) {
  const session = useSessionStore()

  const visible = ref(false)
  const presetDevice = ref<DeviceView | null>(null)
  const stationFilter = ref('')
  const selectedId = ref<number | null>(null)
  const kind = ref<WorkflowKind>('登记故障')
  const remark = ref('')
  const sourceRef = ref('')
  const submitting = ref(false)
  const feedback = ref<{ ok: boolean; text: string } | null>(null)

  const devices = computed<DeviceView[]>(() =>
    readDevices().filter(
      (item) => stationFilter.value.trim() === '' || item.station.includes(stationFilter.value.trim()),
    ),
  )

  const selected = computed<DeviceView | null>(
    () => devices.value.find((item) => item.id === selectedId.value)
      ?? readDevices().find((item) => item.id === selectedId.value)
      ?? null,
  )

  const kindOptions = computed(() =>
    selected.value ? availableKinds(selected.value, session.role) : [],
  )

  function pickDefaultKind() {
    const options = kindOptions.value
    const firstEnabled = options.find((item) => item.enabled)
    if (!options.some((item) => item.enabled && item.kind === kind.value)) {
      kind.value = firstEnabled?.kind ?? '登记故障'
    }
  }

  function open(options: { device?: DeviceView; station?: string; sourceRef?: string } = {}) {
    feedback.value = null
    remark.value = ''
    presetDevice.value = options.device ?? null
    stationFilter.value = options.station ?? options.device?.station ?? ''
    selectedId.value = options.device?.id ?? null
    sourceRef.value = options.sourceRef ?? ''
    kind.value = '登记故障'
    visible.value = true
  }

  function close() {
    if (submitting.value) {
      return
    }
    visible.value = false
  }

  async function confirm(): Promise<WorkflowResult | null> {
    if (!selected.value || submitting.value) {
      return null
    }
    submitting.value = true
    feedback.value = null
    try {
      const result = await submitWorkflow({
        deviceId: selected.value.id,
        kind: kind.value,
        remark: remark.value,
        operator: session.operator,
        role: session.role,
        source,
        sourceRef: sourceRef.value,
      })
      feedback.value = { ok: result.ok, text: result.message }
      if (result.ok) {
        onChanged()
        window.setTimeout(() => {
          visible.value = false
        }, 900)
      }
      return result
    } finally {
      submitting.value = false
    }
  }

  return {
    session,
    visible,
    devices,
    stationFilter,
    selectedId,
    selected,
    presetDevice,
    kind,
    kindOptions,
    remark,
    submitting,
    feedback,
    open,
    close,
    confirm,
    pickDefaultKind,
  }
}

export type FaultWorkflowApi = ReturnType<typeof useFaultWorkflow>
