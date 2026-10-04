import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

/**
 * 通讯设备故障处理：登记、核查、恢复、更换全部收敛在这里。
 *
 * 状态模型：设备行的 status 只表示通讯维度（通讯正常/信号弱/通讯中断/待更换），
 * 故障流转由当前工单 faultTicket 驱动，环节为：
 *   登记故障 → reported（通讯中断·待核查）
 *   现场核查 → verified（已核查，可走恢复或更换）
 *   确认恢复 → recovered（闭环，工单归档进 faultHistory）
 *   申请更换 → replacementRequested（中断保留，同时处于待更换，与恢复互斥）
 * 这样同一台设备可以同时处于「通讯中断」与「待更换」，不再像旧实现那样互相覆盖。
 */

export const COMMUNICATION_KEY = 'communication'

export type OperatorRole = 'inspector' | 'repairer' | 'admin' | 'viewer'

export const ROLE_LABEL: Record<OperatorRole, string> = {
  inspector: '巡检员',
  repairer: '维修员',
  admin: '管理员',
  viewer: '观察员',
}

export const ROLE_OPTIONS = Object.entries(ROLE_LABEL) as [OperatorRole, string][]

export type FaultStage =
  | 'reported' // 已登记（通讯中断，待核查）
  | 'verified' // 现场核查通过（已核查）
  | 'replacementRequested' // 已申请更换（中断·待更换）
  | 'recovered' // 确认恢复（已闭环）

export type FaultAction = '登记故障' | '现场核查' | '确认恢复' | '申请更换'

export type FaultTicket = {
  ticketNo: string
  stage: FaultStage
  description: string
  source: string // 入口来源：通讯系统 / 巡检记录-INSP-xxxx
  inspector: string // 登记人
  reportTime: string
  verifiedBy: string | null // 核查人
  verifyTime: string | null
  verifyNote: string | null
  repairer: string | null // 维护人员（核查环节补录，兼容历史缺维护人员）
  recoveredBy: string | null
  recoverTime: string | null
  replacementRequestedBy: string | null
  replacementRequestedTime: string | null
}

export type FaultContext = {
  operator: string
  role: OperatorRole
  description?: string
  verifyNote?: string
  repairer?: string
  source?: string
}

export type CommunicationDevice = {
  row: EntryRow
  ticket: FaultTicket | null
  faultHistory: FaultTicket[]
}

// 每个动作允许的角色：越权一律拒绝，页面和服务层共用这一份。
export const ACTION_ROLES: Record<FaultAction, OperatorRole[]> = {
  登记故障: ['inspector', 'admin'],
  现场核查: ['repairer', 'admin'],
  确认恢复: ['repairer', 'admin'],
  申请更换: ['admin'],
}

// 历史数据维护人员为空时的占位显示，不直接改原始数据，核查时再补录回写。
export const MISSING_REPAIRER = '待补录（历史未登记）'

// 设备级并发锁：同一设备的动作串行化；锁不释放（沿用首份结果），
// 页面可以 await 到首份提交的结果，重复提交不会再推进状态。
const inflight = new Map<number, Promise<ActionResult>>()
let ticketSeq = 0

export function nowText(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function isFaultTicket(value: unknown): value is FaultTicket {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as FaultTicket).ticketNo === 'string' &&
    typeof (value as FaultTicket).stage === 'string'
  )
}

function readTicket(row: EntryRow): FaultTicket | null {
  return isFaultTicket(row.faultTicket) ? (row.faultTicket as FaultTicket) : null
}

function readHistory(row: EntryRow): FaultTicket[] {
  const value = row.faultHistory
  return Array.isArray(value) ? (value.filter(isFaultTicket) as FaultTicket[]) : []
}

/** 由工单派生给用户看的组合状态：中断与待更换可以同时呈现。 */
export function displayStatus(row: EntryRow): string {
  const ticket = readTicket(row)
  if (!ticket) {
    return String(row.status ?? '通讯正常')
  }
  if (ticket.stage === 'replacementRequested') {
    return '通讯中断 · 待更换'
  }
  if (ticket.stage === 'recovered') {
    return '通讯正常'
  }
  return '通讯中断'
}

/** 该设备当前允许执行的动作：结合阶段与角色，页面置灰与服务层拦截一致。 */
export function availableActions(row: EntryRow, role: OperatorRole): FaultAction[] {
  const actions: FaultAction[] = []
  const ticket = readTicket(row)
  const openTicket = ticket && ticket.stage !== 'recovered' ? ticket : null
  if (!openTicket) actions.push('登记故障')
  if (ticket?.stage === 'reported') actions.push('现场核查')
  if (ticket?.stage === 'verified') {
    actions.push('确认恢复')
    actions.push('申请更换')
  }
  return actions.filter((action) => ACTION_ROLES[action].includes(role))
}

export function getDevice(id: number): CommunicationDevice | null {
  normalizeDevices()
  const row = listRows(COMMUNICATION_KEY).find((item) => Number(item.id) === id)
  if (!row) return null
  return { row, ticket: readTicket(row), faultHistory: readHistory(row) }
}

/** 列出全部设备（派生展示状态并回写同步旧数据，保持列表/详情/看板一致）。 */
export function listDevices(): CommunicationDevice[] {
  normalizeDevices()
  const rows = listRows(COMMUNICATION_KEY)
  return rows.map((row) => ({
    row,
    ticket: readTicket(row),
    faultHistory: readHistory(row),
  }))
}

/**
 * 归一化历史数据：
 * 1) 旧实现把状态写成「通讯中断/待更换」却没有工单，读入时补一张「已登记」工单，
 *    让老数据也必须经过现场核查；维护人员缺失记为待补录，不阻断流程。
 * 2) 旧的「待更换」单值状态无法表达中断，同步成「通讯中断 · 待更换」组合态。
 */
export function normalizeDevices(): void {
  const rows = listRows(COMMUNICATION_KEY)
  let changed = false
  for (const row of rows) {
    const rawStatus = String(row.status ?? '')
    if (!readTicket(row) && (rawStatus === '通讯中断' || rawStatus === '待更换')) {
      const legacyRepairer = String(row['维护人员'] ?? '').trim()
      row.faultTicket = {
        ticketNo: `GD-LEGACY-${row.id}`,
        stage: 'reported',
        description: '历史遗留故障：原系统已标记通讯中断，补录工单待核查',
        source: '历史数据补录',
        inspector: '历史未登记',
        reportTime: '历史未登记',
        verifiedBy: null,
        verifyTime: null,
        verifyNote: null,
        repairer: legacyRepairer || MISSING_REPAIRER,
        recoveredBy: null,
        recoverTime: null,
        replacementRequestedBy: null,
        replacementRequestedTime: null,
      }
      row.status = '通讯中断'
      row.pending = true
      row.abnormal = true
      changed = true
    } else {
      const derived = displayStatus(row)
      if (rawStatus !== derived && (rawStatus === '待更换' || rawStatus === '通讯中断 · 待更换')) {
        row.status = derived
        changed = true
      }
    }
  }
  if (changed) saveRows(COMMUNICATION_KEY, rows)
}

/** 设备维护人员：缺失的历史数据给占位提示，不阻断流程，核查时补录。 */
export function repairerOf(row: EntryRow): string {
  const raw = String(row['维护人员'] ?? '').trim()
  return raw === '' ? MISSING_REPAIRER : raw
}

function assertRole(action: FaultAction, role: OperatorRole): ActionResult | null {
  if (!ACTION_ROLES[action].includes(role)) {
    return {
      ok: false,
      message: `越权操作被拒绝：${ROLE_LABEL[role]}不能执行「${action}」，请联系${
        action === '申请更换'
          ? '管理员'
          : ACTION_ROLES[action].map((r) => ROLE_LABEL[r]).join('或')
      }`,
    }
  }
  return null
}

function mutate(
  id: number,
  fn: (row: EntryRow, ticket: FaultTicket | null) => ActionResult,
): ActionResult {
  const rows = listRows(COMMUNICATION_KEY)
  const index = rows.findIndex((item) => Number(item.id) === id)
  if (index < 0) return { ok: false, message: `没有找到编号为 ${id} 的通讯设备` }
  const before = JSON.stringify(rows[index])
  const result = fn(rows[index], readTicket(rows[index]))
  // 阶段守卫之外的任何拒绝都不落盘；成功才保存，重复提交只保留首份结果。
  if (result.ok && JSON.stringify(rows[index]) !== before) {
    saveRows(COMMUNICATION_KEY, rows)
  }
  return result
}

function nextTicketNo(rows: EntryRow[]): string {
  ticketSeq += 1
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const open = rows.filter((row) => isFaultTicket(row.faultTicket)).length
  return `GD${date}-${String(open + ticketSeq).padStart(3, '0')}`
}

function guardFor(
  action: FaultAction,
  ticket: FaultTicket | null,
): ActionResult | null {
  switch (action) {
    case '登记故障':
      if (ticket && ticket.stage !== 'recovered') {
        return {
          ok: false,
          message: `该设备已有故障工单 ${ticket.ticketNo}（${stageLabel(ticket.stage)}），重复登记已忽略，只保留首份登记`,
        }
      }
      return null
    case '现场核查':
      if (!ticket) return { ok: false, message: '设备没有待核查的故障工单，请先登记故障' }
      if (ticket.stage !== 'reported') {
        return { ok: false, message: `工单当前是「${stageLabel(ticket.stage)}」，不需要重复核查` }
      }
      return null
    case '确认恢复':
      if (!ticket) return { ok: false, message: '设备没有未恢复的故障工单' }
      if (ticket.stage === 'reported') {
        return { ok: false, message: '故障尚未现场核查，核查通过后才能确认恢复' }
      }
      if (ticket.stage === 'replacementRequested') {
        return { ok: false, message: '设备已申请更换，不能再确认恢复' }
      }
      if (ticket.stage === 'recovered') {
        return { ok: false, message: '故障已恢复，请勿重复提交，只保留首份结果' }
      }
      return null
    case '申请更换':
      if (!ticket) return { ok: false, message: '设备没有故障工单，请先登记并核查故障' }
      if (ticket.stage === 'reported') {
        return { ok: false, message: '故障尚未现场核查，核查通过后才能申请更换' }
      }
      if (ticket.stage === 'replacementRequested') {
        return { ok: false, message: '已经提交过更换申请，请勿重复提交' }
      }
      if (ticket.stage === 'recovered') {
        return { ok: false, message: '故障已恢复闭环，无需再申请更换' }
      }
      return null
  }
}

function apply(
  id: number,
  action: FaultAction,
  ctx: FaultContext,
): ActionResult {
  const denied = assertRole(action, ctx.role)
  if (denied) return denied

  return mutate(id, (row, ticket) => {
    const blocked = guardFor(action, ticket)
    if (blocked) return blocked

    if (action === '登记故障') {
      const rows = listRows(COMMUNICATION_KEY)
      const next: FaultTicket = {
        ticketNo: nextTicketNo(rows),
        stage: 'reported',
        description: ctx.description?.trim() || '现场发现通讯故障',
        source: ctx.source?.trim() || '通讯系统',
        inspector: ctx.operator,
        reportTime: nowText(),
        verifiedBy: null,
        verifyTime: null,
        verifyNote: null,
        repairer: null,
        recoveredBy: null,
        recoverTime: null,
        replacementRequestedBy: null,
        replacementRequestedTime: null,
      }
      row.faultTicket = next
      row.status = '通讯中断'
      row.pending = true
      row.abnormal = true
      return { ok: true, message: `故障已登记，工单 ${next.ticketNo}，设备进入「通讯中断·待核查」` }
    }

    if (!ticket) return { ok: false, message: '设备没有故障工单' }

    if (action === '现场核查') {
      // 核查时确定维护人员：表单给了用表单；没给且设备本身有维护人员就沿用；
      // 历史数据两边都缺时记录为待补录，先放行流程，由后续核查/维护补登。
      const provided = ctx.repairer?.trim() ?? ''
      const existing = String(row['维护人员'] ?? '').trim()
      const repairer = provided || existing || MISSING_REPAIRER
      ticket.stage = 'verified'
      ticket.verifiedBy = ctx.operator
      ticket.verifyTime = nowText()
      ticket.verifyNote = ctx.verifyNote?.trim() || '现场核查：故障属实，待处理'
      ticket.repairer = repairer
      if (provided) row['维护人员'] = provided // 历史缺维护人员在此回写补录
      row.status = '通讯中断'
      row.pending = true
      row.abnormal = true
      return { ok: true, message: `工单 ${ticket.ticketNo} 现场核查完成，维护人员：${repairer}` }
    }

    if (action === '确认恢复') {
      ticket.stage = 'recovered'
      ticket.recoveredBy = ctx.operator
      ticket.recoverTime = nowText()
      const history = readHistory(row)
      row.faultHistory = [...history, { ...ticket }]
      row.faultTicket = null
      row.status = '通讯正常'
      row.pending = false
      row.abnormal = false
      return { ok: true, message: `工单 ${ticket.ticketNo} 已确认恢复并归档，设备恢复「通讯正常」` }
    }

    // 申请更换：中断工单保留，仅追加更换标记，组合态为「通讯中断 · 待更换」。
    ticket.stage = 'replacementRequested'
    ticket.replacementRequestedBy = ctx.operator
    ticket.replacementRequestedTime = nowText()
    row.status = '通讯中断 · 待更换'
    row.pending = true
    row.abnormal = true
    return { ok: true, message: `工单 ${ticket.ticketNo} 已申请更换，设备保持中断并进入「待更换」` }
  })
}

/**
 * 提交故障动作。同一设备的并发提交在这里串行化：
 * 首份调用持锁真正推进状态，持锁期间到来的重复/并发提交直接返回「处理中」拒绝，
 * 不会重复落盘；首份完成后再提交则命中阶段守卫，状态也只推进一次。
 */
export async function submitFaultAction(
  id: number,
  action: FaultAction,
  ctx: FaultContext,
): Promise<ActionResult> {
  const existing = inflight.get(id)
  if (existing) {
    await existing.catch(() => undefined)
    return { ok: false, message: '上一笔故障处理尚未完成，本次并发提交已忽略，只推进一次' }
  }
  const task = Promise.resolve().then(() =>
    // 让出一个微任务，确保同时点下的并发调用都能先看到锁。
    new Promise<ActionResult>((resolve) =>
      setTimeout(() => resolve(apply(id, action, ctx)), 0),
    ),
  )
  inflight.set(id, task)
  try {
    return await task
  } finally {
    inflight.delete(id)
  }
}

export function stageLabel(stage: FaultStage): string {
  switch (stage) {
    case 'reported':
      return '通讯中断·待核查'
    case 'verified':
      return '已核查·待处理'
    case 'replacementRequested':
      return '通讯中断·待更换'
    case 'recovered':
      return '已恢复'
  }
}

/** 看板指标：中断数含待更换（仍处于中断），待更换单独统计。 */
export function communicationStats(devices: CommunicationDevice[]): {
  total: number
  normal: number
  interrupted: number
  replacement: number
} {
  let normal = 0
  let interrupted = 0
  let replacement = 0
  for (const { ticket } of devices) {
    if (!ticket || ticket.stage === 'recovered') {
      normal += 1
    } else {
      interrupted += 1
      if (ticket.stage === 'replacementRequested') replacement += 1
    }
  }
  return { total: devices.length, normal, interrupted, replacement }
}
