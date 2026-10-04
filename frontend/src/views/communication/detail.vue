<template>
  <section class="page" data-module="communication-detail">
    <header class="page-head">
      <div>
        <h2>通讯设备详情</h2>
        <p class="page-desc">
          <RouterLink class="link" to="/communication">返回通讯系统列表</RouterLink>
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="workflow.open({ device: device ?? undefined })">
          故障处理
        </button>
      </div>
    </header>

    <div v-if="!device" class="stat-card">
      <p class="error-text">找不到该通讯设备，可能已被重置。</p>
    </div>

    <template v-else>
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">通讯环节</span>
          <strong class="stat-value">{{ device.commState }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">故障环节</span>
          <strong class="stat-value">{{ device.faultPhase }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">更换环节</span>
          <strong class="stat-value">{{ device.replacePhase }}</strong>
        </article>
      </div>

      <table class="data-table">
        <tbody>
          <tr v-for="item in facts" :key="item.label">
            <th style="width: 160px">{{ item.label }}</th>
            <td>
              {{ item.value || '—' }}
              <span v-if="item.missing" class="badge warn">历史缺登记，处理时将由当前值班员代办</span>
            </td>
          </tr>
        </tbody>
      </table>

      <h3 style="font-size: 14px; margin: 18px 0 8px">处理记录（每个环节一份，重复提交沿用首份结果）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>处理单号</th>
            <th>环节</th>
            <th>提交人/角色</th>
            <th>来源</th>
            <th>备注</th>
            <th>首份结果</th>
            <th>提交时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="ticket in tickets" :key="ticket.id">
            <td>#{{ ticket.id }}</td>
            <td>{{ ticket.kind }}</td>
            <td>
              {{ ticket.operator }}（{{ roleLabel(ticket.role) }}）
              <div v-if="ticket.maintainerBackfilled" class="badge warn">已代办补录维护人员：{{ ticket.maintainer }}</div>
            </td>
            <td>{{ ticket.source }}{{ ticket.sourceRef ? ` · ${ticket.sourceRef}` : '' }}</td>
            <td>{{ ticket.remark || '—' }}</td>
            <td>{{ ticket.result }}</td>
            <td>{{ formatTime(ticket.createdAt) }}</td>
          </tr>
          <tr v-if="!tickets.length">
            <td colspan="7" class="empty-state">暂无处理记录</td>
          </tr>
        </tbody>
      </table>
    </template>

    <FaultWorkflowDialog :api="workflow" />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import {
  findDevice,
  formatTime,
  ticketsOfDevice,
  type DeviceView,
} from '@/api/communication-workflow'
import FaultWorkflowDialog from '@/components/FaultWorkflowDialog.vue'
import { useFaultWorkflow } from '@/composables/useFaultWorkflow'
import { ROLE_LABELS, type RoleKey, type WorkflowTicket } from '@/data/types'

const route = useRoute()
const deviceId = computed(() => Number(route.params.id))
const device = ref<DeviceView | null>(null)
const tickets = ref<WorkflowTicket[]>([])

function reload() {
  device.value = findDevice(deviceId.value) ?? null
  tickets.value = device.value ? ticketsOfDevice(device.value.id) : []
}

const workflow = useFaultWorkflow('通讯设备详情', reload)

watch(deviceId, reload, { immediate: true })

const facts = computed(() => {
  if (!device.value) {
    return []
  }
  const d = device.value
  return [
    { label: '设备编号', value: d.code },
    { label: '设备类型', value: d.type },
    { label: '所属站点', value: d.station },
    { label: '通讯协议', value: d.protocol },
    { label: '信号强度', value: d.signal },
    { label: '最近通讯时刻', value: d.lastAt },
    { label: '维护人员', value: d.maintainerMissing ? '' : d.maintainer, missing: d.maintainerMissing },
  ]
})

function roleLabel(role: RoleKey): string {
  return ROLE_LABELS[role] ?? role
}
</script>
