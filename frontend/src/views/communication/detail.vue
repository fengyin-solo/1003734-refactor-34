<template>
  <section class="page communication-detail">
    <header class="page-head">
      <div>
        <h2>通讯设备详情</h2>
        <p class="page-desc">
          <RouterLink class="link" to="/communication">← 返回通讯系统列表</RouterLink>
        </p>
      </div>
    </header>

    <template v-if="device">
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">当前状态</span>
          <strong class="stat-value">{{ displayStatus(device.row) }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">故障环节</span>
          <strong class="stat-value">{{ device.ticket ? stageLabel(device.ticket.stage) : '无未闭环工单' }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">维护人员</span>
          <strong class="stat-value" :class="{ 'missing-text': missing }">
            {{ missing ? MISSING_REPAIRER : device.row['维护人员'] }}
          </strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">历史故障次数</span>
          <strong class="stat-value">{{ device.faultHistory.length }}</strong>
        </article>
      </div>

      <table class="data-table detail-table">
        <tbody>
          <tr v-for="field in fields" :key="field">
            <th>{{ field }}</th>
            <td>{{ device.row[field] ?? '—' }}</td>
          </tr>
        </tbody>
      </table>

      <h3 class="block-title">故障处置</h3>
      <div class="row-actions action-bar">
        <button
          v-for="action in allowedActions"
          :key="action"
          class="btn"
          :class="{ primary: action === '登记故障' }"
          type="button"
          @click="openFault(action)"
        >
          {{ action }}
        </button>
        <span v-if="!allowedActions.length" class="page-desc">当前身份暂无可执行动作（工单已闭环或需要切换身份）。</span>
      </div>

      <h3 class="block-title">当前工单</h3>
      <table v-if="device.ticket" class="data-table">
        <thead>
          <tr><th>环节</th><th>工单号</th><th>登记人/时间</th><th>核查人/时间</th><th>维护人员</th><th>来源</th><th>更换申请</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>{{ stageLabel(device.ticket.stage) }}</td>
            <td>{{ device.ticket.ticketNo }}</td>
            <td>{{ device.ticket.inspector }}<br />{{ device.ticket.reportTime }}</td>
            <td>{{ device.ticket.verifiedBy ?? '—' }}<br />{{ device.ticket.verifyTime ?? '' }}</td>
            <td :class="{ 'missing-text': device.ticket.repairer === MISSING_REPAIRER }">
              {{ device.ticket.repairer ?? '—' }}
            </td>
            <td>{{ device.ticket.source }}</td>
            <td>{{ device.ticket.replacementRequestedBy ?? '—' }}<br />{{ device.ticket.replacementRequestedTime ?? '' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="page-desc">暂无未闭环故障工单。</p>

      <h3 class="block-title">工单轨迹</h3>
      <ol class="timeline">
        <li v-for="item in timeline" :key="item.key" :class="{ active: item.active }">
          <strong>{{ item.label }}</strong>
          <span>{{ item.text }}</span>
        </li>
      </ol>

      <h3 class="block-title">历史故障归档</h3>
      <table v-if="device.faultHistory.length" class="data-table">
        <thead>
          <tr><th>工单号</th><th>故障现象</th><th>登记人/时间</th><th>恢复人/时间</th><th>来源</th></tr>
        </thead>
        <tbody>
          <tr v-for="ticket in [...device.faultHistory].reverse()" :key="ticket.ticketNo">
            <td>{{ ticket.ticketNo }}</td>
            <td>{{ ticket.description }}</td>
            <td>{{ ticket.inspector }}<br />{{ ticket.reportTime }}</td>
            <td>{{ ticket.recoveredBy ?? '—' }}<br />{{ ticket.recoverTime ?? '' }}</td>
            <td>{{ ticket.source }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="page-desc">暂无历史故障记录。</p>
    </template>

    <p v-else class="empty-state">没有找到这台通讯设备，<RouterLink class="link" to="/communication">返回列表</RouterLink>。</p>

    <FaultHandleDialog
      :open="dialog.open"
      :device="device"
      :action="dialog.action"
      :source="'通讯设备详情'"
      @close="dialog.open = false"
      @done="onDialogDone"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import {
  MISSING_REPAIRER,
  availableActions,
  displayStatus,
  getDevice,
  repairerOf,
  stageLabel,
  type CommunicationDevice,
  type FaultAction,
} from '@/api/communication'
import FaultHandleDialog from '@/components/FaultHandleDialog.vue'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const store = useSessionStore()

const fields = ['设备编号', '设备类型', '所属站点', '通讯协议', '信号强度', '最近通讯时刻', '维护人员', '设备状态']
const device = ref<CommunicationDevice | null>(null)
const dialog = reactive<{ open: boolean; action: FaultAction }>({ open: false, action: '登记故障' })

const missing = computed(() => !!device.value && repairerOf(device.value.row) === MISSING_REPAIRER)
const allowedActions = computed(() =>
  device.value ? availableActions(device.value.row, store.role) : [],
)

const timeline = computed(() => {
  const ticket = device.value?.ticket
  const items = [
    {
      key: 'report',
      label: '登记故障',
      active: !!ticket,
      text: ticket ? `${ticket.inspector} · ${ticket.reportTime}｜${ticket.description}（来源：${ticket.source}）` : '未发生',
    },
    {
      key: 'verify',
      label: '现场核查',
      active: !!ticket && ['verified', 'replacementRequested', 'recovered'].includes(ticket.stage),
      text: ticket?.verifiedBy
        ? `${ticket.verifiedBy} · ${ticket.verifyTime}｜${ticket.verifyNote ?? ''}｜维护人员：${ticket.repairer ?? '—'}`
        : '待核查',
    },
  ]
  if (ticket?.stage === 'replacementRequested') {
    items.push({
      key: 'replace',
      label: '申请更换',
      active: true,
      text: `${ticket.replacementRequestedBy} · ${ticket.replacementRequestedTime}｜设备中断保留，等待更换`,
    })
  } else {
    items.push({
      key: 'recover',
      label: '确认恢复',
      active: !!device.value?.faultHistory.some((item) => item.ticketNo === ticket?.ticketNo) || ticket?.stage === 'recovered',
      text: ticket?.recoveredBy ? `${ticket.recoveredBy} · ${ticket.recoverTime}｜已闭环归档` : '待处理',
    })
  }
  return items
})

function reload() {
  const id = Number(route.params.id)
  device.value = Number.isFinite(id) ? getDevice(id) : null
}

function openFault(action: FaultAction) {
  dialog.action = action
  dialog.open = true
}

function onDialogDone() {
  dialog.open = false
  reload()
}

watch(() => route.params.id, reload)
onMounted(reload)
</script>
