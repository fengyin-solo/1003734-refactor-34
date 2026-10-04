/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

// 工单这类结构化字段（faultTicket / faultHistory）也要能挂在行数据上持久化。
// 用 unknown 做索引槽位而不是递归联合类型：递归索引签名会让 Vue 的 UnwrapRef 推导爆栈
// （TS2589），需要结构化值的地方在服务层用类型守卫收窄。
export type EntryValue = string | number | boolean | null | unknown[] | Record<string, unknown>

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: EntryValue
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

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
