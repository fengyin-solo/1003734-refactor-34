import { listRows, saveRows } from '@/data/local-store'
import type {
  CommState,
  FaultPhase,
  ReplacePhase,
  RoleKey,
  WorkflowKind,
  WorkflowResult,
  WorkflowSubmission,
  WorkflowTicket,
} from '@/data/types'
import type { EntryRow } from '@/data/types'

/**
 * 通讯设备故障处理领域服务。
 *
 * 历史实现把「通讯中断」和「待更换」压在同一条 status 字段里互相覆盖，
 * 这里拆成两个并行环节：故障环节（登记→核查→恢复）与更换环节（申请→完成），
 * 同一设备可以同时处于「通讯中断」与「待更换」，互不抹除。
 *
 * 列表页、设备详情页、巡检链路都只走 submitWorkflow 这一个入口。
 */

const DEVICE_KEY = 'communication'
const TICKET_KEY = 'communication_ticket'
const MAINTAINER_FIELD = '维护人员'
// 历史种子数据里的占位值与空值一样视为「缺维护人员」。
const PLACEHOLDER_MAINTAINER = /^通讯系统样例\d*$/

// 每种处理允许的角色：越权动作直接拒绝，不推进状态。
const KIND_ROLES: Record<WorkflowKind, RoleKey[]> = {
  登记故障: ['inspector', 'admin'],
  故障核查: ['admin'],
  确认恢复: ['operator', 'admin'],
  申请更换: ['operator', 'admin'],
  完成更换: ['admin'],
}

const KIND_PHASE: Record<WorkflowKind, string> = {
  登记故障: '登记故障',
  故障核查: '故障核查',
  确认恢复: '确认恢复',
  申请更换: '申请更换',
  完成更换: '完成更换',
}

export type DeviceView = {
  id: number
  code: string
  type: string
  station: string
  protocol: string
  signal: string
  lastAt: string
  maintainer: string
  maintainerMissing: boolean
  raw: EntryRow
  commState: CommState
  faultPhase: FaultPhase
  replacePhase: ReplacePhase
  /** 供看板沿用：两个环节有一个没闭环就算待处理。 */
  pending: boolean
  abnormal: boolean
}

function text(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

function isMissingMaintainer(value: string): boolean {
  return value === '' || PLACEHOLDER_MAINTAINER.test(value)
}

function mapLegacyState(status: string): { commState: CommState; fault: FaultPhase; replace: ReplacePhase } {
  switch (status) {
    case '通讯中断':
      return { commState: '通讯中断', fault: '待核查', replace: '未申请' }
    case '待更换':
      return { commState: '通讯中断', fault: '已核查', replace: '待更换' }
    case '信号弱':
      return { commState: '信号弱', fault: '无故障', replace: '未申请' }
    case '通讯正常':
    default:
      return { commState: '通讯正常', fault: '无故障', replace: '未申请' }
  }
}

// 把旧的单 status 记录读成双环节视图；读到尚未迁移的数据时顺手补字段并落库。
export function readDevices(): DeviceView[] {
  const rows = listRows(DEVICE_KEY)
  let migrated = false
  const views = rows.map((row) => {
    let commState = text(row, '通讯环节') as CommState
    let fault = text(row, '故障环节') as FaultPhase
    let replace = text(row, '更换环节') as ReplacePhase
    if (!commState || !fault || !replace) {
      const mapped = mapLegacyState(String(row.status))
      commState = mapped.commState
      fault = mapped.fault
      replace = mapped.replace
      Object.assign(row, { 通讯环节: commState, 故障环节: fault, 更换环节: replace })
      migrated = true
    }
    const maintainer = text(row, MAINTAINER_FIELD)
    return {
      id: Number(row.id),
      code: text(row, '设备编号'),
      type: text(row, '设备类型'),
      station: text(row, '所属站点'),
      protocol: text(row, '通讯协议'),
      signal: text(row, '信号强度'),
      lastAt: text(row, '最近通讯时刻'),
      maintainer,
      maintainerMissing: isMissingMaintainer(maintainer),
      raw: row,
      commState,
      faultPhase: fault,
      replacePhase: replace,
      pending: fault !== '无故障' && fault !== '已恢复' || replace === '待更换',
      abnormal: commState === '通讯中断' || replace === '待更换',
    }
  })
  if (migrated) {
    saveRows(DEVICE_KEY, rows)
  }
  return views
}

export function findDevice(deviceId: number): DeviceView | undefined {
  return readDevices().find((item) => item.id === deviceId)
}

function persistDevice(view: DeviceView, patch: Partial<EntryRow>): void {
  const rows = listRows(DEVICE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === view.id)
  if (index < 0) {
    return
  }
  const next = { ...rows[index], ...patch } as EntryRow
  next.pending =
    (String(next['故障环节']) !== '无故障' && String(next['故障环节']) !== '已恢复') ||
    String(next['更换环节']) === '待更换'
  next.abnormal = String(next['通讯环节']) === '通讯中断' || String(next['更换环节']) === '待更换'
  next.status = String(next['通讯环节'])
  rows[index] = next
  saveRows(DEVICE_KEY, rows)
}

export function listTickets(): WorkflowTicket[] {
  return listRows(TICKET_KEY).map((row) => normalizeTicket(row))
}

export function ticketsOfDevice(deviceId: number): WorkflowTicket[] {
  return listTickets()
    .filter((ticket) => ticket.deviceId === deviceId)
    .sort((a, b) => a.createdAt - b.createdAt)
}

function normalizeTicket(row: EntryRow): WorkflowTicket {
  return {
    id: Number(row.id),
    deviceId: Number(row.deviceId),
    deviceCode: String(row.deviceCode ?? ''),
    station: String(row.station ?? ''),
    kind: String(row.kind) as WorkflowKind,
    operator: String(row.operator ?? ''),
    role: String(row.role ?? 'admin') as RoleKey,
    maintainer: String(row.maintainer ?? ''),
    maintainerBackfilled: Boolean(row.maintainerBackfilled),
    source: String(row.source ?? ''),
    sourceRef: String(row.sourceRef ?? ''),
    remark: String(row.remark ?? ''),
    result: String(row.result ?? ''),
    dedupKey: String(row.dedupKey ?? ''),
    afterFault: String(row.afterFault) as FaultPhase,
    afterReplace: String(row.afterReplace) as ReplacePhase,
    createdAt: Number(row.createdAt ?? 0),
  }
}

function persistTicket(ticket: Omit<WorkflowTicket, 'id'>): WorkflowTicket {
  const rows = listRows(TICKET_KEY)
  const saved: WorkflowTicket = { ...ticket, id: rows.length ? Math.max(...rows.map((r) => Number(r.id))) + 1 : 1 }
  const record: EntryRow = {
    ...(saved as unknown as EntryRow),
    pending: false,
    abnormal: false,
    status: ticket.kind,
  }
  rows.push(record)
  saveRows(TICKET_KEY, rows)
  return saved
}

// 当前设备状态下，这个处理环节能不能再往前走。不满足条件给出中文原因。
function transitionCheck(kind: WorkflowKind, view: DeviceView): string | null {
  switch (kind) {
    case '登记故障':
      if (view.faultPhase === '待核查' || view.faultPhase === '已核查') {
        return `设备已登记故障（${view.faultPhase}），不能重复登记`
      }
      return null
    case '故障核查':
      if (view.faultPhase !== '待核查') {
        return view.faultPhase === '已核查'
          ? '故障已经核查过，无需重复核查'
          : '只有待核查的故障才能核查'
      }
      return null
    case '确认恢复':
      if (view.faultPhase !== '已核查') {
        return '故障需先核查通过，才能确认恢复'
      }
      if (view.replacePhase === '待更换') {
        return '设备已申请更换，等待更换完成，不再确认恢复'
      }
      return null
    case '申请更换':
      if (view.replacePhase === '待更换') {
        return '设备已在待更换，不能重复申请'
      }
      if (view.replacePhase === '已更换') {
        return '设备已完成更换'
      }
      if (view.faultPhase !== '已核查') {
        return '故障需先核查属实，才能申请更换'
      }
      return null
    case '完成更换':
      if (view.replacePhase !== '待更换') {
        return '只有待更换的设备才能完成更换'
      }
      return null
  }
}

type Stage = { fault: FaultPhase; replace: ReplacePhase; comm: CommState; result: string }

function nextStage(kind: WorkflowKind, view: DeviceView, maintainer: string): Stage {
  switch (kind) {
    case '登记故障':
      return {
        fault: '待核查',
        replace: view.replacePhase,
        comm: '通讯中断',
        result: `故障已登记，设备转为通讯中断，待核查（维护人员：${maintainer}）`,
      }
    case '故障核查':
      return {
        fault: '已核查',
        replace: view.replacePhase,
        comm: '通讯中断',
        result: '故障核查属实，等待恢复或申请更换',
      }
    case '确认恢复':
      return {
        fault: '已恢复',
        replace: view.replacePhase,
        comm: '通讯正常',
        result: '通讯已恢复，故障流程闭环',
      }
    case '申请更换':
      // 更换期间故障环节仍保持「已核查」，直到更换完成才与设备一起闭环。
      return {
        fault: view.faultPhase,
        replace: '待更换',
        comm: '通讯中断',
        result: '更换申请已受理，设备标记为待更换',
      }
    case '完成更换':
      return {
        fault: '已恢复',
        replace: '已更换',
        comm: '通讯正常',
        result: '新设备已更换到位，通讯恢复正常',
      }
  }
}

/**
 * 同一个设备、同一个处理环节的在途提交共享一把锁：
 * 并发进来的提交等首份落库后，直接沿用首份结果，状态只推进一次。
 */
const inflight = new Map<string, Promise<WorkflowResult>>()

// 模拟落库耗时，让并发点击在首份提交完成前都进入同一把锁。
const WRITE_DELAY = 200

export function submitWorkflow(input: WorkflowSubmission): Promise<WorkflowResult> {
  const lockKey = `${input.deviceId}:${input.kind}`
  const running = inflight.get(lockKey)
  if (running) {
    return running.then((first) => ({
      ok: first.ok,
      code: first.code,
      ticketId: first.ticketId,
      message: `已按首次提交处理，本次重复提交不再推进：${first.message}`,
    }))
  }

  const task = processSubmit(input).finally(() => {
    inflight.delete(lockKey)
  })
  inflight.set(lockKey, task)
  return task
}

async function processSubmit(input: WorkflowSubmission): Promise<WorkflowResult> {
  const view = findDevice(input.deviceId)
  if (!view) {
    return { ok: false, code: 'NOT_FOUND', message: `没有找到编号为 ${input.deviceId} 的通讯设备` }
  }

  // 越权动作拒绝：连状态校验都不做，也不留处理记录。
  if (!KIND_ROLES[input.kind].includes(input.role)) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: `${input.operator}（${input.role}）无权执行「${input.kind}」，该操作已被拒绝`,
    }
  }

  // 重复提交：同设备 + 同环节 + 首份结果还成立（环节未继续流转）时，只保留首份结果。
  const dedupKey = `${input.deviceId}:${KIND_PHASE[input.kind]}`
  const first = listTickets().find((ticket) => ticket.dedupKey === dedupKey)
  if (first && phaseStillMatches(first, view)) {
    return {
      ok: true,
      code: 'DEDUPED',
      ticketId: first.id,
      message: `该设备此前已${first.kind}（处理单 #${first.id}），沿用首份结果：${first.result}`,
    }
  }

  const invalid = transitionCheck(input.kind, view)
  if (invalid) {
    return { ok: false, code: 'INVALID_STATE', message: invalid }
  }

  await new Promise((resolve) => window.setTimeout(resolve, WRITE_DELAY))

  // 二次确认：等待期间若状态已被推进，后到的并发提交不再推进。
  const latest = findDevice(input.deviceId)
  if (!latest) {
    return { ok: false, code: 'NOT_FOUND', message: `没有找到编号为 ${input.deviceId} 的通讯设备` }
  }
  const invalidNow = transitionCheck(input.kind, latest)
  if (invalidNow) {
    return { ok: false, code: 'INVALID_STATE', message: invalidNow }
  }

  // 历史缺维护人员：由当前提交人代办并回写到设备档案，处理单里留痕。
  let maintainer = latest.maintainer
  let backfilled = false
  if (latest.maintainerMissing) {
    maintainer = input.operator
    backfilled = true
  }

  const stage = nextStage(input.kind, latest, maintainer)
  persistDevice(latest, {
    通讯环节: stage.comm,
    故障环节: stage.fault,
    更换环节: stage.replace,
    ...(backfilled ? { [MAINTAINER_FIELD]: maintainer } : {}),
  })

  const remark = [
    input.remark?.trim(),
    backfilled ? `历史数据缺维护人员，由 ${input.operator} 代办并补登记` : '',
  ]
    .filter(Boolean)
    .join('；')

  const saved = persistTicket({
    deviceId: latest.id,
    deviceCode: latest.code,
    station: latest.station,
    kind: input.kind,
    operator: input.operator,
    role: input.role,
    maintainer,
    maintainerBackfilled: backfilled,
    source: input.source || '通讯系统',
    sourceRef: input.sourceRef || '',
    remark,
    result: stage.result,
    dedupKey,
    afterFault: stage.fault,
    afterReplace: stage.replace,
    createdAt: Date.now(),
  })

  return { ok: true, code: 'OK', ticketId: saved.id, message: stage.result }
}

function phaseStillMatches(ticket: WorkflowTicket, view: DeviceView): boolean {
  // 环节已继续往前走（已核查/已恢复/已更换）时，旧提交不再算重复，允许下一环节提交。
  switch (ticket.kind) {
    case '登记故障':
      return view.faultPhase === '待核查'
    case '故障核查':
      return view.faultPhase === '已核查'
    case '确认恢复':
      return view.faultPhase === '已恢复'
    case '申请更换':
      return view.replacePhase === '待更换'
    case '完成更换':
      return view.replacePhase === '已更换'
  }
}

// 列出某设备当前可执行的处理环节（供入口展示；真正的裁决仍在提交时做）。
export function availableKinds(view: DeviceView, role: RoleKey): { kind: WorkflowKind; enabled: boolean; reason: string }[] {
  const all: WorkflowKind[] = ['登记故障', '故障核查', '确认恢复', '申请更换', '完成更换']
  return all.map((kind) => {
    if (!KIND_ROLES[kind].includes(role)) {
      return { kind, enabled: false, reason: '当前角色无权执行' }
    }
    const reason = transitionCheck(kind, view)
    return { kind, enabled: reason === null, reason: reason ?? '' }
  })
}

export function formatTime(ts: number): string {
  if (!ts) {
    return '—'
  }
  const date = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
