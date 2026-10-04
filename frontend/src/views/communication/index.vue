<template>
  <section class="page" data-module="communication">
    <header class="page-head">
      <div>
        <h2>通讯系统管理</h2>
        <p class="page-desc">
          故障统一走工单入口：登记故障 → 现场核查 → 确认恢复 / 申请更换；中断与待更换可并存。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记通讯设备</button>
        <button class="btn" type="button" @click="exportRows">导出通讯系统清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>故障环节</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="device in filtered" :key="String(device.row.id)">
          <td v-for="column in columns" :key="column">
            <RouterLink v-if="column === '设备编号'" class="link" :to="`/communication/${device.row.id}`">
              {{ device.row[column] ?? '—' }}
            </RouterLink>
            <template v-else>{{ device.row[column] ?? '—' }}</template>
          </td>
          <td>{{ device.ticket ? stageLabel(device.ticket.stage) : '—' }}</td>
          <td>{{ displayStatus(device.row) }}</td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(device.row, store.role)"
              :key="action"
              class="link"
              type="button"
              @click="openFault(device, action)"
            >
              {{ action }}
            </button>
            <RouterLink class="link" :to="`/communication/${device.row.id}`">详情</RouterLink>
          </td>
        </tr>
        <tr v-if="!filtered.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无通讯系统数据，可先登记通讯设备</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ filtered.length }} 条通讯系统记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <FaultHandleDialog
      :open="dialog.open"
      :device="dialog.device"
      :action="dialog.action"
      :source="'通讯系统'"
      @close="dialog.open = false"
      @done="onDialogDone"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  availableActions,
  communicationStats,
  displayStatus,
  listDevices,
  stageLabel,
  type CommunicationDevice,
  type FaultAction,
} from '@/api/communication'
import FaultHandleDialog from '@/components/FaultHandleDialog.vue'
import { downloadEntries, moduleMeta } from '@/api/local-service'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const meta = moduleMeta('communication')
const columns = ['设备编号', '设备类型', '所属站点', '通讯协议', '信号强度', '最近通讯时刻', '维护人员', '设备状态']
const filterFields = columns.slice(0, 3)

const devices = ref<CommunicationDevice[]>([])
const filters = ref<Record<string, string>>({})
const errorMessage = ref('')

const dialog = reactive<{ open: boolean; device: CommunicationDevice | null; action: FaultAction }>({
  open: false,
  device: null,
  action: '登记故障',
})

const filtered = computed(() => {
  const pairs = Object.entries(filters.value).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) return devices.value
  return devices.value.filter(({ row }) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
})

const stats = computed(() => communicationStats(devices.value))
const statCards = computed(() => [
  { label: '设备总数', value: stats.value.total },
  { label: '通讯正常数', value: stats.value.normal },
  { label: '中断设备数', value: stats.value.interrupted },
  { label: '待更换数', value: stats.value.replacement },
])

const legendStatuses = ['通讯正常', '信号弱', '通讯中断', '通讯中断 · 待更换']
const statusSummary = computed(() =>
  legendStatuses.map((status) => ({
    status,
    count: devices.value.filter(({ row }) => displayStatus(row) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '通讯设备登记入口尚未接入审批流'
}

function openFault(device: CommunicationDevice, action: FaultAction) {
  dialog.device = device
  dialog.action = action
  dialog.open = true
}

function onDialogDone() {
  dialog.open = false
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    devices.value = listDevices()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '通讯系统列表读取失败'
  }
}

onMounted(reload)
</script>
