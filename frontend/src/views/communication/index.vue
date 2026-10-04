<template>
  <section class="page" data-module="communication">
    <header class="page-head">
      <div>
        <h2>通讯系统管理</h2>
        <p class="page-desc">故障登记、核查、恢复与更换走统一处理入口；故障环节与更换环节并行，设备可同时通讯中断且待更换。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="workflow.open()">故障处理</button>
        <button class="btn" type="button" @click="exportRows">导出通讯系统清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.label" class="legend-item">
        {{ item.label }}：{{ item.count }}
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
          <th>通讯环节</th>
          <th>故障环节</th>
          <th>更换环节</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '设备编号'">
              <RouterLink class="link" :to="`/communication/${row.id}`">{{ row.code }}</RouterLink>
              <span v-if="row.maintainerMissing" class="badge warn">缺维护人员</span>
            </template>
            <template v-else-if="column === '维护人员'">{{ row.maintainerMissing ? '待补登记' : row.maintainer }}</template>
            <template v-else>{{ row.raw[column] || '—' }}</template>
          </td>
          <td>
            <span :class="['badge', commBadge(row.commState)]">{{ row.commState }}</span>
          </td>
          <td>{{ row.faultPhase }}</td>
          <td>
            <span :class="['badge', row.replacePhase === '未申请' ? 'ok' : row.replacePhase === '已更换' ? 'ok' : 'danger']">
              {{ row.replacePhase }}
            </span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="workflow.open({ device: row })">处理</button>
            <RouterLink class="link" :to="`/communication/${row.id}`">详情/记录</RouterLink>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无符合条件的通讯设备</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条通讯设备记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <FaultWorkflowDialog :api="workflow" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, filterRows, moduleMeta } from '@/api/local-service'
import { readDevices, type DeviceView } from '@/api/communication-workflow'
import FaultWorkflowDialog from '@/components/FaultWorkflowDialog.vue'
import { useFaultWorkflow } from '@/composables/useFaultWorkflow'

const meta = moduleMeta('communication')
const columns = ['设备编号', '设备类型', '所属站点', '通讯协议', '信号强度', '最近通讯时刻', '维护人员']
const filterFields = ['设备编号', '设备类型', '所属站点']

const rows = ref<DeviceView[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const workflow = useFaultWorkflow('通讯系统列表', reload)

const allDevices = ref<DeviceView[]>([])

const stats = computed(() => [
  { label: '设备总数', value: allDevices.value.length },
  { label: '通讯正常数', value: allDevices.value.filter((r) => r.commState === '通讯正常').length },
  { label: '中断设备数', value: allDevices.value.filter((r) => r.commState === '通讯中断').length },
  { label: '待更换数', value: allDevices.value.filter((r) => r.replacePhase === '待更换').length },
])

const statusSummary = computed(() => [
  { label: '通讯正常', count: allDevices.value.filter((r) => r.commState === '通讯正常').length },
  { label: '信号弱', count: allDevices.value.filter((r) => r.commState === '信号弱').length },
  { label: '通讯中断', count: allDevices.value.filter((r) => r.commState === '通讯中断').length },
  { label: '待核查', count: allDevices.value.filter((r) => r.faultPhase === '待核查').length },
  { label: '待更换', count: allDevices.value.filter((r) => r.replacePhase === '待更换').length },
])

function commBadge(state: string): string {
  if (state === '通讯正常') {
    return 'ok'
  }
  if (state === '信号弱') {
    return 'warn'
  }
  return 'danger'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  errorMessage.value = ''
  try {
    allDevices.value = readDevices()
    const matched = filterRows(
      allDevices.value.map((item) => item.raw),
      filters.value,
    )
    const matchedIds = new Set(matched.map((item) => Number(item.id)))
    rows.value = allDevices.value.filter((item) => matchedIds.has(item.id))
    total.value = rows.value.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '通讯系统列表读取失败'
  }
}

onMounted(reload)
</script>
