import type { StatsGranularity } from '@/types/api'

/** 时间窗预设；custom = 使用 from/to（datetime-local 字符串） */
export type StatsPeriod = 'today' | 'yesterday' | '24h' | '7d' | '30d' | 'month' | 'custom'
/** auto = 跨度 ≤ 3 天按小时，否则按天 */
export type GranularityMode = 'auto' | StatsGranularity

export const PERIODS: { value: Exclude<StatsPeriod, 'custom'>; label: string }[] = [
  { value: 'today', label: '今天' },
  { value: 'yesterday', label: '昨天' },
  { value: '24h', label: '24 小时' },
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
  { value: 'month', label: '本月' },
]

/** 后端小时桶与天桶都只保留最近 31 天 */
export const RETENTION_DAYS = 31

export interface ResolvedWindow {
  startTs: number
  endTs: number
  granularity: StatsGranularity
}

const pad = (n: number) => String(n).padStart(2, '0')
const sec = (d: Date) => Math.floor(d.getTime() / 1000)

function startOfDay(d: Date, offsetDays = 0): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() + offsetDays)
  return x
}

/** Date -> `YYYY-MM-DDTHH:mm`（本地时间，datetime-local 的 value 格式） */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** `YYYY-MM-DDTHH:mm` -> Date（本地时间）；非法返回 null */
export function parseLocalInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatWindowText(startTs: number, endTs: number): string {
  const f = (t: number) => toLocalInput(new Date(t * 1000)).replace('T', ' ')
  return `${f(startTs)} → ${f(endTs)}`
}

/** 预设对应的原始时间窗（未按粒度对齐） */
function rawWindow(period: StatsPeriod, from: string, to: string, now: Date): [Date, Date] | null {
  const tomorrow = startOfDay(now, 1)
  switch (period) {
    case 'today':
      return [startOfDay(now), tomorrow]
    case 'yesterday':
      return [startOfDay(now, -1), startOfDay(now)]
    case '24h': {
      // 含当前小时，共 24 个小时桶
      const end = new Date(now)
      end.setMinutes(0, 0, 0)
      end.setHours(end.getHours() + 1)
      return [new Date(end.getTime() - 24 * 3600_000), end]
    }
    case '7d':
      return [startOfDay(now, -6), tomorrow]
    case '30d':
      return [startOfDay(now, -29), tomorrow]
    case 'month':
      return [new Date(now.getFullYear(), now.getMonth(), 1), tomorrow]
    case 'custom': {
      const a = parseLocalInput(from)
      const b = parseLocalInput(to)
      return a && b && b > a ? [a, b] : null
    }
  }
}

/**
 * 解析成发给后端的精确窗口。起点向下、终点向上对齐到桶边界，
 * 否则后端「桶起点 ∈ [start, end)」的判定会漏掉首尾不完整的桶。
 * 非法的自定义区间回退到 24 小时。
 */
export function resolveWindow(
  period: StatsPeriod,
  from: string,
  to: string,
  mode: GranularityMode,
  now: Date = new Date(),
): ResolvedWindow {
  const [start, end] = rawWindow(period, from, to, now) ?? rawWindow('24h', '', '', now)!
  const granularity: StatsGranularity =
    mode !== 'auto' ? mode : end.getTime() - start.getTime() <= 3 * 86400_000 ? 'hour' : 'day'
  const s = new Date(start)
  const e = new Date(end)
  if (granularity === 'hour') {
    s.setMinutes(0, 0, 0)
    if (e.getMinutes() || e.getSeconds() || e.getMilliseconds()) {
      e.setMinutes(0, 0, 0)
      e.setHours(e.getHours() + 1)
    }
  } else {
    s.setHours(0, 0, 0, 0)
    if (e.getHours() || e.getMinutes() || e.getSeconds() || e.getMilliseconds()) {
      e.setHours(0, 0, 0, 0)
      e.setDate(e.getDate() + 1)
    }
  }
  return { startTs: sec(s), endTs: sec(e), granularity }
}
