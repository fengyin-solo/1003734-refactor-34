import { defineStore } from 'pinia'

import type { OperatorRole } from '@/api/communication'
import { ROLE_LABEL } from '@/api/communication'

const ROLE_KEY = 'hydrology-monitor-station:role'

function initialRole(): OperatorRole {
  if (typeof window !== 'undefined' && window.localStorage) {
    const saved = window.localStorage.getItem(ROLE_KEY)
    if (saved && saved in ROLE_LABEL) return saved as OperatorRole
  }
  return 'inspector'
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '水文监测站网管理系统',
    role: initialRole() as OperatorRole,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    roleLabel: (state) => ROLE_LABEL[state.role],
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: OperatorRole) {
      this.role = role
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(ROLE_KEY, role)
      }
    },
  },
})
