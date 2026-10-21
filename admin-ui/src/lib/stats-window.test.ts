import { expect, test } from 'bun:test'
import { resolveWindow } from './stats-window'

const now = new Date(2026, 9, 14, 15, 37) // 2026-10-14 15:37 本地
const ts = (...a: [number, number, number, number?]) => new Date(a[0], a[1], a[2], a[3] ?? 0).getTime() / 1000

test('24h 预设含当前小时，共 24 个小时桶', () => {
  const w = resolveWindow('24h', '', '', 'auto', now)
  expect(w.granularity).toBe('hour')
  expect(w.endTs).toBe(ts(2026, 9, 14, 16))
  expect(w.endTs - w.startTs).toBe(24 * 3600)
})

test('7 天自动按天，从 6 天前零点到明天零点', () => {
  const w = resolveWindow('7d', '', '', 'auto', now)
  expect(w).toEqual({ startTs: ts(2026, 9, 8), endTs: ts(2026, 9, 15), granularity: 'day' })
})

test('自定义区间对齐到桶边界', () => {
  const h = resolveWindow('custom', '2026-10-13T08:30', '2026-10-13T10:10', 'auto', now)
  expect(h).toEqual({ startTs: ts(2026, 9, 13, 8), endTs: ts(2026, 9, 13, 11), granularity: 'hour' })
  const d = resolveWindow('custom', '2026-10-01T08:30', '2026-10-10T10:00', 'day', now)
  expect(d).toEqual({ startTs: ts(2026, 9, 1), endTs: ts(2026, 9, 11), granularity: 'day' })
})

test('非法自定义区间回退到 24 小时', () => {
  expect(resolveWindow('custom', '2026-10-13T10:00', '2026-10-13T09:00', 'auto', now))
    .toEqual(resolveWindow('24h', '', '', 'auto', now))
})
