/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

// 通讯设备故障处理：故障流程与更换流程并行，设备可以同时「通讯中断」与「待更换」。
export type CommState = '通讯正常' | '信号弱' | '通讯中断'
export type FaultPhase = '无故障' | '待核查' | '已核查' | '已恢复'
export type ReplacePhase = '未申请' | '待更换' | '已更换'

export type WorkflowKind =
  | '登记故障'
  | '故障核查'
  | '确认恢复'
  | '申请更换'
  | '完成更换'

export type RoleKey = 'inspector' | 'operator' | 'admin'

export const ROLE_LABELS: Record<RoleKey, string> = {
  inspector: '巡检员',
  operator: '值班员',
  admin: '管理员',
}

// 一次处理提交（故障登记 / 核查 / 恢复 / 更换共用同一个入口）。
export type WorkflowSubmission = {
  deviceId: number
  kind: WorkflowKind
  remark?: string
  operator: string
  role: RoleKey
  source: string
  sourceRef?: string
}

export type WorkflowCode = 'OK' | 'DEDUPED' | 'FORBIDDEN' | 'INVALID_STATE' | 'NOT_FOUND'

export type WorkflowResult = {
  ok: boolean
  code: WorkflowCode
  message: string
  ticketId?: number
}

// 处理单：设备状态每推进一步就留一条，首份结果也记在这里，供重复提交时原样沿用。
export type WorkflowTicket = {
  id: number
  deviceId: number
  deviceCode: string
  station: string
  kind: WorkflowKind
  operator: string
  role: RoleKey
  maintainer: string
  maintainerBackfilled: boolean
  source: string
  sourceRef: string
  remark: string
  result: string
  dedupKey: string
  afterFault: FaultPhase
  afterReplace: ReplacePhase
  createdAt: number
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
