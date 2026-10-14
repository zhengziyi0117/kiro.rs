import { memo, useMemo, useState } from 'react'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { StatsGranularity, TimeSeriesPoint } from '@/types/api'
import { tooltipCursorStyle } from './tooltip-style'
import { formatCredits, formatNumber } from '@/lib/utils'

export type TrendMetric = 'tokens' | 'credits' | 'calls'

interface Props {
  data: TimeSeriesPoint[]
  granularity: StatsGranularity
  /** 查询窗口（Unix 秒，左闭右开），用于补齐无数据的桶 */
  startTs: number
  endTs: number
  metric: TrendMetric
  /** 拖拽框选（或按天视图点击单个桶）后回调选中的时间窗（Unix 秒，左闭右开） */
  onRangeSelect?: (startTs: number, endTs: number) => void
}

interface ChartPoint {
  t: number
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  totalInput: number
  cacheHitRate: number
  calls: number
  errors: number
  success: number
  credits: number
}

type SeriesKind = 'line' | 'area' | 'bar'
interface SeriesDef {
  key: keyof ChartPoint
  name: string
  color: string
  kind: SeriesKind
  axis: 'left' | 'right'
  dashed?: boolean
  stack?: string
}

const SERIES: Record<TrendMetric, SeriesDef[]> = {
  tokens: [
    { key: 'cacheReadTokens', name: '缓存读', color: '#06b6d4', kind: 'area', axis: 'left' },
    { key: 'inputTokens', name: '未缓存输入', color: '#3b82f6', kind: 'line', axis: 'left' },
    { key: 'cacheCreationTokens', name: '缓存写', color: '#f59e0b', kind: 'line', axis: 'left' },
    { key: 'outputTokens', name: '输出', color: '#10b981', kind: 'line', axis: 'left' },
    { key: 'cacheHitRate', name: '命中率', color: '#a855f7', kind: 'line', axis: 'right', dashed: true },
  ],
  credits: [{ key: 'credits', name: 'Credit', color: '#ec4899', kind: 'area', axis: 'left' }],
  calls: [
    { key: 'success', name: '成功', color: '#10b981', kind: 'bar', axis: 'left', stack: 'calls' },
    { key: 'errors', name: '异常', color: '#ef4444', kind: 'bar', axis: 'left', stack: 'calls' },
  ],
}

const pad = (n: number) => String(n).padStart(2, '0')

function formatTick(t: number, granularity: StatsGranularity, spansDays: boolean): string {
  const d = new Date(t * 1000)
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (granularity === 'day') return md
  const hm = `${pad(d.getHours())}:00`
  return spansDays ? `${md} ${hm}` : hm
}

function formatFull(t: number, granularity: StatsGranularity): string {
  const d = new Date(t * 1000)
  const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (granularity === 'day') return ymd
  return `${ymd} ${pad(d.getHours())}:00 - ${pad((d.getHours() + 1) % 24)}:00`
}

/** 下一个桶的起点（按本地时间对齐，天粒度兼容夏令时） */
export function nextBucket(t: number, granularity: StatsGranularity): number {
  const d = new Date(t * 1000)
  if (granularity === 'hour') d.setHours(d.getHours() + 1, 0, 0, 0)
  else d.setDate(d.getDate() + 1)
  return Math.floor(d.getTime() / 1000)
}

function toPoint(t: number, p?: TimeSeriesPoint): ChartPoint {
  const input = p?.inputTokens ?? 0
  const cacheW = p?.cacheCreationTokens ?? 0
  const cacheR = p?.cacheReadTokens ?? 0
  const totalInput = input + cacheW + cacheR
  const calls = p?.calls ?? 0
  const errors = p?.errors ?? 0
  return {
    t,
    inputTokens: input,
    outputTokens: p?.outputTokens ?? 0,
    cacheCreationTokens: cacheW,
    cacheReadTokens: cacheR,
    totalInput,
    // 与概览卡片一致：缓存读 / 总输入
    cacheHitRate: totalInput > 0 ? (cacheR / totalInput) * 100 : 0,
    calls,
    errors,
    success: Math.max(calls - errors, 0),
    credits: p?.credits ?? 0,
  }
}

/**
 * 后端只返回有数据的桶；这里按窗口补齐空桶，避免折线把空闲时段直接连起来造成误读。
 * 不补未来的桶（截止到当前时间）。
 */
export function fillBuckets(
  data: TimeSeriesPoint[],
  startTs: number,
  endTs: number,
  granularity: StatsGranularity,
): ChartPoint[] {
  const byTs = new Map<number, TimeSeriesPoint>()
  for (const p of data) byTs.set(Math.floor(new Date(p.ts).getTime() / 1000), p)
  const limit = Math.min(endTs, Math.floor(Date.now() / 1000) + 1)
  const out: ChartPoint[] = []
  // 安全上限，防止异常窗口导致死循环
  for (let t = startTs; t < limit && out.length < 2000; t = nextBucket(t, granularity)) {
    out.push(toPoint(t, byTs.get(t)))
    byTs.delete(t)
  }
  // 理论上不会出现未对齐的桶；若有则并入，保证数据不丢
  for (const [t, p] of byTs) if (t >= startTs && t < endTs) out.push(toPoint(t, p))
  return out.sort((a, b) => a.t - b.t)
}

function ChartTooltip({
  active,
  payload,
  granularity,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: ChartPoint }>
  granularity: StatsGranularity
}) {
  const p = payload?.[0]?.payload
  if (!active || !p) return null
  const rows: [string, string, string][] = [
    ['调用', formatNumber(p.calls), '#94a3b8'],
    ['异常', formatNumber(p.errors), '#ef4444'],
    ['总输入', formatNumber(p.totalInput), '#3b82f6'],
    ['· 缓存读', formatNumber(p.cacheReadTokens), '#06b6d4'],
    ['· 缓存写', formatNumber(p.cacheCreationTokens), '#f59e0b'],
    ['· 未缓存', formatNumber(p.inputTokens), '#3b82f6'],
    ['输出', formatNumber(p.outputTokens), '#10b981'],
    ['命中率', `${p.cacheHitRate.toFixed(1)}%`, '#a855f7'],
    ['Credit', formatCredits(p.credits), '#ec4899'],
  ]
  return (
    <div className="min-w-[190px] rounded-lg border border-white/10 bg-neutral-900/95 px-3.5 py-2.5 text-xs text-white shadow-xl">
      <div className="mb-1.5 font-semibold text-white/90">{formatFull(p.t, granularity)}</div>
      {rows.map(([name, value, color]) => (
        <div key={name} className="flex items-center gap-2 py-px">
          <span className="inline-block size-2 rounded-sm" style={{ background: color }} />
          <span className="flex-1 text-white/75">{name}</span>
          <span className="tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  )
}

function TimeSeriesChartImpl({ data, granularity, startTs, endTs, metric, onRangeSelect }: Props) {
  const points = useMemo(
    () => fillBuckets(data, startTs, endTs, granularity),
    [data, startTs, endTs, granularity],
  )
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null)
  const series = SERIES[metric]
  const spansDays = points.length > 0 && new Date(points[0].t * 1000).toDateString()
    !== new Date(points[points.length - 1].t * 1000).toDateString()
  const hasData = points.some((p) => p.calls > 0 || p.totalInput > 0)
  const hasRight = series.some((s) => s.axis === 'right')

  const finishDrag = () => {
    if (!drag || !onRangeSelect) return setDrag(null)
    const lo = Math.min(drag.a, drag.b)
    const hi = Math.max(drag.a, drag.b)
    setDrag(null)
    // 小时视图单击不下钻（只有一个桶没有意义）；按天视图单击 = 下钻到该天
    if (lo === hi && granularity === 'hour') return
    onRangeSelect(lo, nextBucket(hi, granularity))
  }

  if (points.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
        所选时间窗内暂无数据
      </div>
    )
  }

  return (
    <div className="relative h-[280px] select-none sm:h-[340px]">
      {!hasData && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">
          所选时间窗内暂无调用
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={points}
          margin={{ top: 8, right: hasRight ? 4 : 12, left: -8, bottom: 0 }}
          onMouseDown={(e) => {
            const t = Number(e?.activeLabel)
            if (Number.isFinite(t) && t > 0) setDrag({ a: t, b: t })
          }}
          onMouseMove={(e) => {
            const t = Number(e?.activeLabel)
            if (drag && Number.isFinite(t) && t > 0) setDrag({ ...drag, b: t })
          }}
          onMouseUp={finishDrag}
          onMouseLeave={() => setDrag(null)}
        >
          <defs>
            {series.filter((s) => s.kind === 'area').map((s) => (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/50" />
          <XAxis
            dataKey="t"
            tick={{ fontSize: 11 }}
            className="fill-muted-foreground"
            tickFormatter={(t: number) => formatTick(t, granularity, spansDays)}
            minTickGap={24}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11 }}
            className="fill-muted-foreground"
            tickFormatter={(v: number) => (metric === 'credits' && v < 1000 ? String(Number(v.toFixed(2))) : formatNumber(v))}
            width={52}
            allowDecimals={metric === 'credits'}
          />
          {hasRight && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11, fill: '#a855f7' }}
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v: number) => `${v}%`}
              width={40}
            />
          )}
          <Tooltip
            content={<ChartTooltip granularity={granularity} />}
            cursor={metric === 'calls' ? tooltipCursorStyle : { stroke: 'currentColor', strokeOpacity: 0.2 }}
          />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, paddingBottom: 8, cursor: 'pointer' }}
            onClick={(e) => {
              const key = String(e.dataKey)
              setHidden((prev) => {
                const next = new Set(prev)
                if (next.has(key)) next.delete(key)
                else next.add(key)
                return next
              })
            }}
            formatter={(value, entry) => (
              <span style={{ opacity: hidden.has(String(entry.dataKey)) ? 0.35 : 1 }}>{value}</span>
            )}
          />
          {series.map((s) => renderSeries(s, hidden.has(s.key)))}
          {drag && drag.a !== drag.b && (
            <ReferenceArea
              yAxisId="left"
              x1={Math.min(drag.a, drag.b)}
              x2={Math.max(drag.a, drag.b)}
              fill="currentColor"
              fillOpacity={0.08}
              className="text-primary"
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function renderSeries(s: SeriesDef, hide: boolean) {
  const common = {
    yAxisId: s.axis,
    dataKey: s.key,
    name: s.name,
    hide,
    isAnimationActive: false,
  }
  if (s.kind === 'bar') {
    return <Bar key={s.key} {...common} fill={s.color} stackId={s.stack} maxBarSize={28} radius={s.key === 'errors' ? [3, 3, 0, 0] : 0} />
  }
  if (s.kind === 'area') {
    return (
      <Area
        key={s.key}
        {...common}
        type="monotone"
        stroke={s.color}
        strokeWidth={2}
        fill={`url(#grad-${s.key})`}
        dot={false}
        activeDot={{ r: 3 }}
      />
    )
  }
  return (
    <Line
      key={s.key}
      {...common}
      type="monotone"
      stroke={s.color}
      strokeWidth={s.dashed ? 1.5 : 2}
      strokeDasharray={s.dashed ? '4 4' : undefined}
      dot={false}
      activeDot={{ r: 3 }}
    />
  )
}

export const TimeSeriesChart = memo(TimeSeriesChartImpl)
