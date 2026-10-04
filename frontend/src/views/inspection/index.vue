<template>
  <section class="page" data-module="inspection">
    <header class="page-head">
      <div>
        <h2>巡检记录管理</h2>
        <p class="page-desc">维护巡检记录，围绕记录编号、站点编号、巡检日期、巡检人员做登记、筛选与状态流转；巡检发现的通讯设备故障在此直接登记。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡检记录</button>
        <button class="btn" type="button" @click="exportRows">导出巡检记录清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
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
          <th>当前状态</th>
          <th>巡检动作</th>
          <th>通讯设备故障</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openCommFault(row)">通讯故障登记</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无巡检记录数据，可先登记巡检记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条巡检记录记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 巡检链路复用同一故障处理入口：先选设备与动作，再打开共用处置弹窗 -->
    <div v-if="pickOpen" class="modal-mask" @click.self="pickOpen = false">
      <div class="modal" role="dialog" aria-modal="true" aria-label="巡检发现通讯故障">
        <header class="modal-head">
          <h3>巡检发现通讯故障 · {{ sourceLabel }}</h3>
          <button class="link" type="button" @click="pickOpen = false">关闭</button>
        </header>
        <div class="modal-body">
          <label class="modal-field">
            <span>通讯设备</span>
            <select v-model="selectedDeviceId" @change="onDeviceChange">
              <option value="" disabled>请选择故障设备</option>
              <option v-for="device in devices" :key="String(device.row.id)" :value="Number(device.row.id)">
                {{ device.row['设备编号'] }}（{{ device.row['所属站点'] }}）— {{ displayStatus(device.row) }}
              </option>
            </select>
          </label>
          <label class="modal-field">
            <span>处置环节</span>
            <select v-model="selectedAction" :disabled="!selectedDevice">
              <option v-for="action in pickActions" :key="action" :value="action">{{ action }}</option>
            </select>
          </label>
          <p v-if="selectedDevice && !pickActions.length" class="error-text">
            当前身份（{{ store.roleLabel }}）对该设备暂无可执行动作，可切换身份后重试。
          </p>
          <p v-else-if="selectedDevice" class="page-desc">
            该设备当前环节：{{ selectedDevice.ticket ? stageLabel(selectedDevice.ticket.stage) : '无未闭环工单' }}
          </p>
        </div>
        <footer class="modal-foot">
          <span class="modal-buttons">
            <button class="btn ghost" type="button" @click="pickOpen = false">取消</button>
            <button
              class="btn primary"
              type="button"
              :disabled="!selectedDevice || !pickActions.length"
              @click="openHandle"
            >
              进入处置
            </button>
          </span>
        </footer>
      </div>
    </div>

    <FaultHandleDialog
      :open="handleOpen"
      :device="selectedDevice"
      :action="selectedAction"
      :source="sourceLabel"
      @close="handleOpen = false"
      @done="onHandleDone"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  availableActions,
  displayStatus,
  listDevices,
  stageLabel,
  type CommunicationDevice,
  type FaultAction,
} from '@/api/communication'
import FaultHandleDialog from '@/components/FaultHandleDialog.vue'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const store = useSessionStore()
const meta = moduleMeta('inspection')
const columns = ["记录编号", "站点编号", "巡检日期", "巡检人员", "检查项目", "发现问题", "处理措施", "巡检状态"]
const actions = ["完成巡检", "报告故障", "确认处置"]
const statuses = ["待巡检", "已巡检", "发现故障", "已处置"]
const stats = [{"label": "本月巡检次数", "value": 0}, {"label": "已巡检站点", "value": 0}, {"label": "待处置故障", "value": 0}]
const allFaultActions: FaultAction[] = ['登记故障', '现场核查', '确认恢复', '申请更换']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const devices = ref<CommunicationDevice[]>([])
const pickOpen = ref(false)
const handleOpen = ref(false)
const selectedDeviceId = ref<number | ''>('')
const selectedAction = ref<FaultAction>('登记故障')
const inspectionSource = ref('')

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const selectedDevice = computed(
  () => devices.value.find((device) => Number(device.row.id) === selectedDeviceId.value) ?? null,
)

// 处置环节同样按设备阶段与当前身份收敛，和列表、详情完全一致。
const pickActions = computed<FaultAction[]>(() =>
  selectedDevice.value ? availableActions(selectedDevice.value.row, store.role) : allFaultActions,
)

const sourceLabel = computed(() =>
  inspectionSource.value ? `巡检记录-${inspectionSource.value}` : '巡检记录',
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '巡检记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

// 巡检中发现通讯设备故障：与通讯列表/详情共用同一处理入口与同一份状态机。
function openCommFault(row: EntryRow) {
  errorMessage.value = ''
  devices.value = listDevices()
  inspectionSource.value = String(row['记录编号'] ?? row.id)
  // 若该巡检站点恰好与某台设备所属站点一致，默认选中它。
  const station = String(row['站点编号'] ?? '')
  const matched = devices.value.find((device) => String(device.row['所属站点']) === station)
  selectedDeviceId.value = matched ? Number(matched.row.id) : ''
  selectedAction.value = '登记故障'
  pickOpen.value = true
}

function onDeviceChange() {
  selectedAction.value = pickActions.value[0] ?? '登记故障'
}

function openHandle() {
  if (!selectedDeviceId.value || !pickActions.value.length) return
  handleOpen.value = true
}

function onHandleDone() {
  handleOpen.value = false
  pickOpen.value = false
  devices.value = listDevices()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '巡检记录列表读取失败'
  }
}

onMounted(reload)
</script>
