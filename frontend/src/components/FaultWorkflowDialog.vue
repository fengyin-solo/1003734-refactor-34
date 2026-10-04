<template>
  <div v-if="api.visible.value" class="modal-mask" @click.self="api.close()">
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="通讯设备故障处理">
      <header class="modal-head">
        <h3>通讯设备故障处理</h3>
        <button class="link" type="button" :disabled="api.submitting.value" @click="api.close()">关闭</button>
      </header>

      <div class="modal-body">
        <p class="modal-tip">
          统一入口：故障登记 → 故障核查 → 确认恢复 / 申请更换 → 完成更换。
          当前值班：{{ api.session.operator }}（{{ api.session.roleLabel }}）
        </p>

        <label v-if="!api.presetDevice.value" class="form-item">
          <span>所属站点筛选</span>
          <input v-model="api.stationFilter.value" placeholder="如：官厅水库站" />
        </label>

        <label class="form-item">
          <span>通讯设备</span>
          <select
            :value="api.selectedId.value"
            :disabled="Boolean(api.presetDevice.value)"
            @change="onDeviceChange"
          >
            <option :value="null" disabled>请选择设备</option>
            <option v-for="device in api.devices.value" :key="device.id" :value="device.id">
              {{ device.code }} · {{ device.station }} · {{ device.type }}（{{ device.commState }}／{{ device.faultPhase }}／{{ device.replacePhase }}）
            </option>
          </select>
        </label>

        <div v-if="device" class="device-snapshot">
          <span>通讯协议：{{ device.protocol || '—' }}</span>
          <span>信号强度：{{ device.signal || '—' }}</span>
          <span>最近通讯：{{ device.lastAt || '—' }}</span>
          <span>
            维护人员：{{ device.maintainerMissing ? '历史缺登记，将由当前值班员代办并补录' : device.maintainer }}
          </span>
        </div>

        <fieldset class="form-item">
          <legend>处理环节</legend>
          <div class="kind-list">
            <label v-for="option in api.kindOptions.value" :key="option.kind" class="kind-option">
              <input v-model="api.kind.value" type="radio" :value="option.kind" :disabled="!option.enabled" />
              <span :class="{ 'is-disabled': !option.enabled }">{{ option.kind }}</span>
              <small v-if="!option.enabled">{{ option.reason }}</small>
            </label>
          </div>
        </fieldset>

        <label class="form-item">
          <span>备注 / 核查意见</span>
          <textarea v-model="api.remark.value" rows="3" placeholder="可填故障现象、核查结论或更换说明"></textarea>
        </label>

        <p v-if="api.feedback.value" class="feedback" :class="api.feedback.value.ok ? 'ok' : 'fail'">
          {{ api.feedback.value.text }}
        </p>
      </div>

      <footer class="modal-foot">
        <button class="btn ghost" type="button" :disabled="api.submitting.value" @click="api.close()">取消</button>
        <button class="btn primary" type="button" :disabled="!device || api.submitting.value" @click="api.confirm()">
          {{ api.submitting.value ? '提交中…' : '提交处理' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'

import type { FaultWorkflowApi } from '@/composables/useFaultWorkflow'

const props = defineProps<{ api: FaultWorkflowApi }>()

const device = computed(() => props.api.selected.value)

function onDeviceChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  props.api.selectedId.value = value === '' ? null : Number(value)
}

watch(
  () => [props.api.visible.value, props.api.selectedId.value, props.api.session.role],
  () => {
    if (props.api.visible.value && props.api.selectedId.value !== null) {
      props.api.pickDefaultKind()
    }
  },
)
</script>
