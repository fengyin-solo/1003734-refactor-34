<template>
  <div v-if="open" class="modal-mask" @click.self="cancel">
    <div class="modal" role="dialog" aria-modal="true" aria-label="通讯设备故障处置">
      <header class="modal-head">
        <h3>{{ action }} · 通讯设备故障处置</h3>
        <button class="link" type="button" :disabled="submitting" @click="cancel">关闭</button>
      </header>

      <div class="modal-body">
        <dl class="device-brief">
          <div><dt>设备编号</dt><dd>{{ device?.row['设备编号'] }}</dd></div>
          <div><dt>所属站点</dt><dd>{{ device?.row['所属站点'] }}</dd></div>
          <div><dt>当前状态</dt><dd>{{ device ? displayStatus(device.row) : '—' }}</dd></div>
          <div>
            <dt>维护人员</dt>
            <dd :class="{ 'missing-text': missingRepairer }">
              {{ device ? (missingRepairer ? MISSING_REPAIRER : device.row['维护人员']) : '—' }}
            </dd>
          </div>
        </dl>

        <p class="source-tip">入口来源：{{ source }} · 操作人：{{ store.operator }}（{{ store.roleLabel }}）</p>

        <label v-if="action === '登记故障'" class="modal-field">
          <span>故障现象</span>
          <textarea v-model="form.description" rows="2" placeholder="如：遥测数据中断、现场无法呼叫"></textarea>
        </label>

        <template v-if="action === '现场核查'">
          <label class="modal-field">
            <span>核查结论</span>
            <textarea v-model="form.verifyNote" rows="2" placeholder="现场核查情况，留空默认「故障属实，待处理」"></textarea>
          </label>
          <label class="modal-field">
            <span>维护人员{{ missingRepairer ? '（历史缺登记，请补录）' : '（留空沿用现有维护人员）' }}</span>
            <input v-model="form.repairer" :placeholder="missingRepairer ? MISSING_REPAIRER : String(device?.row['维护人员'] ?? '')" />
          </label>
        </template>

        <p v-if="permissionDenied" class="error-text">
          越权操作会被拒绝：{{ store.roleLabel }}不能执行「{{ action }}」，需要{{ allowedText }}。
        </p>
      </div>

      <footer class="modal-foot">
        <span v-if="message" :class="resultOk ? 'success-text' : 'error-text'">{{ message }}</span>
        <span class="modal-buttons">
          <button class="btn ghost" type="button" :disabled="submitting" @click="cancel">取消</button>
          <button
            class="btn primary"
            type="button"
            :disabled="submitting || permissionDenied"
            @click="submit"
          >
            {{ submitting ? '提交中…' : `确认${action}` }}
          </button>
        </span>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import {
  ACTION_ROLES,
  MISSING_REPAIRER,
  ROLE_LABEL,
  displayStatus,
  repairerOf,
  submitFaultAction,
  type CommunicationDevice,
  type FaultAction,
} from '@/api/communication'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{
  open: boolean
  device: CommunicationDevice | null
  action: FaultAction
  source: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'done'): void
}>()

const store = useSessionStore()
const submitting = ref(false)
const message = ref('')
const resultOk = ref(false)
const form = reactive({ description: '', verifyNote: '', repairer: '' })

const missingRepairer = computed(
  () => !!props.device && repairerOf(props.device.row) === MISSING_REPAIRER,
)

const allowedText = computed(() =>
  ACTION_ROLES[props.action]
    .map((role) => ROLE_LABEL[role])
    .join('或'),
)

const permissionDenied = computed(
  () => !ACTION_ROLES[props.action].includes(store.role),
)

watch(
  () => props.open,
  (open) => {
    if (open) {
      message.value = ''
      resultOk.value = false
      form.description = ''
      form.verifyNote = ''
      // 历史维护人员缺失时默认带出当前操作人，方便补录。
      form.repairer = missingRepairer.value ? store.operator : ''
    }
  },
)

function cancel() {
  if (submitting.value) return
  emit('close')
}

async function submit() {
  if (!props.device || submitting.value) return
  submitting.value = true
  message.value = ''
  try {
    const result = await submitFaultAction(Number(props.device.row.id), props.action, {
      operator: store.operator,
      role: store.role,
      description: form.description,
      verifyNote: form.verifyNote,
      repairer: form.repairer,
      source: props.source,
    })
    resultOk.value = result.ok
    message.value = result.message
    if (result.ok) emit('done')
  } finally {
    submitting.value = false
  }
}
</script>
