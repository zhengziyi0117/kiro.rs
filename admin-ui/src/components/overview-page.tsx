import { useCallback, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Activity,
  Coins,
  Cpu,
  Filter,
  KeyRound,
  RotateCcw,
  Server,
  Undo2,
  X,
  Zap,
} from 'lucide-react'
import { useByCredential, useByKey, useByModel, useOverview, useTimeSeries } from '@/hooks/use-stats'
import { AutoRefreshControl } from '@/components/console/auto-refresh-control'
import { PageHeader } from '@/components/console/page-header'
import { useClientKeys } from '@/hooks/use-client-keys'
import { useGroupOptions } from '@/hooks/use-groups'
import { useUrlState } from '@/hooks/use-url-state'
import type {
  ClientKeyItem,
  CredentialDistribution,
  KeyDistribution,
  ModelDistribution,
  StatsFilter,
  StatsTimeFilter,
  TimeSeriesPoint,
} from '@/types/api'
import { TimeSeriesChart, type TrendMetric } from '@/components/charts/time-series-chart'
import { ModelPieChart } from '@/components/charts/model-pie-chart'
import { CredentialBarChart } from '@/components/charts/credential-bar-chart'
import { KeyBarChart } from '@/components/charts/key-bar-chart'
import { cn, formatCredits, formatNumber } from '@/lib/utils'
import {
  PERIODS,
  RETENTION_DAYS,
  formatWindowText,
  resolveWindow,
  toLocalInput,
  type GranularityMode,
  type StatsPeriod,
} from '@/lib/stats-window'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const URL_DEFAULTS = {
  p: '24h',
  from: '',
  to: '',
  g: 'auto',
  key: 'all',
  group: 'all',
  model: 'all',
  m: 'tokens',
}
type UrlState = typeof URL_DEFAULTS
type TimeState = Pick<UrlState, 'p' | 'from' | 'to' | 'g'>

const PERIOD_VALUES: StatsPeriod[] = ['today', 'yesterday', '24h', '7d', '30d', 'month', 'custom']
const GRANULARITY_OPTIONS: { value: GranularityMode; label: string }[] = [
  { value: 'auto', label: '自动粒度' },
  { value: 'hour', label: '按小时' },
  { value: 'day', label: '按天' },
]
const METRICS: { value: TrendMetric; label: string }[] = [
  { value: 'tokens', label: 'Token' },
  { value: 'credits', label: 'Credit' },
  { value: 'calls', label: '调用' },
]

function asPeriod(v: string): StatsPeriod {
  return (PERIOD_VALUES as string[]).includes(v) ? (v as StatsPeriod) : '24h'
}
function asGranularity(v: string): GranularityMode {
  return v === 'hour' || v === 'day' ? v : 'auto'
}
function asMetric(v: string): TrendMetric {
  return v === 'credits' || v === 'calls' ? v : 'tokens'
}

export function OverviewPage() {
  const [url, patchUrl, resetUrl] = useUrlState('overview', URL_DEFAULTS)
  // 图表框选 / 下钻前的时间窗，用于「返回上一步」
  const [zoomStack, setZoomStack] = useState<TimeState[]>([])

  const period = asPeriod(url.p)
  const gMode = asGranularity(url.g)
  const metric = asMetric(url.m)
  // 每次渲染重新解析：滚动窗口（24 小时 / 今天）随自动刷新自然前移
  const win = resolveWindow(period, url.from, url.to, gMode)
  const timeFilter = useMemo<StatsTimeFilter>(
    () => ({ startTs: win.startTs, endTs: win.endTs, granularity: win.granularity }),
    [win.startTs, win.endTs, win.granularity],
  )
  const statsFilter = useMemo<StatsFilter>(() => {
    const f: StatsFilter = {}
    if (url.key !== 'all') f.keyId = Number(url.key)
    if (url.group !== 'all') f.group = url.group
    if (url.model !== 'all') f.model = url.model
    return f
  }, [url.key, url.group, url.model])

  const overviewQuery = useOverview()
  const keysQuery = useClientKeys()
  const groupOptions = useGroupOptions()
  const seriesQuery = useTimeSeries(timeFilter, statsFilter)
  const modelQuery = useByModel(timeFilter, statsFilter)
  const credentialQuery = useByCredential(timeFilter, statsFilter)
  const keyQuery = useByKey(timeFilter, statsFilter)
  const queries = [overviewQuery, keysQuery, seriesQuery, modelQuery, credentialQuery, keyQuery]
  const refreshStats = useCallback(
    async () => {
      await Promise.all(queries.map((q) => q.refetch()))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    queries,
  )
  const isRefreshing = queries.some((q) => q.isFetching)

  const seriesData = useMemo(() => seriesQuery.data ?? [], [seriesQuery.data])
  const modelData = useMemo(() => modelQuery.data ?? [], [modelQuery.data])
  const credData = useMemo(() => credentialQuery.data ?? [], [credentialQuery.data])
  const keyData = useMemo(() => keyQuery.data ?? [], [keyQuery.data])
  const keys = keysQuery.data?.keys ?? []
  const rangeStats = useMemo(() => aggregateSeries(seriesData), [seriesData])
  const windowText = formatWindowText(win.startTs, win.endTs)
  const granText = win.granularity === 'hour' ? '按小时' : '按天'

  const setTime = (next: Partial<TimeState>, keepZoom = false) => {
    if (!keepZoom) setZoomStack([])
    patchUrl(next)
  }
  const zoomTo = (startTs: number, endTs: number) => {
    setZoomStack((s) => [...s, { p: url.p, from: url.from, to: url.to, g: url.g }])
    patchUrl({
      p: 'custom',
      from: toLocalInput(new Date(startTs * 1000)),
      to: toLocalInput(new Date(endTs * 1000)),
      g: 'auto',
    })
  }
  const zoomBack = () => {
    const prev = zoomStack[zoomStack.length - 1]
    if (!prev) return
    setZoomStack((s) => s.slice(0, -1))
    patchUrl(prev)
  }
  const toggle = (field: 'key' | 'model', value: string) =>
    patchUrl({ [field]: url[field] === value ? 'all' : value })

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: '控制台' }, { label: '仪表概览', active: true }]}
        icon={<Activity className="h-4 w-4" />}
        title="仪表概览"
        description="按任意时间窗与维度筛选调用量、Token 与 Credit 消耗。"
        actions={
          <AutoRefreshControl onRefresh={refreshStats} isRefreshing={isRefreshing} resourceLabel="概览数据" />
        }
      />
      <FilterBar
        url={url}
        period={period}
        gMode={gMode}
        startTs={win.startTs}
        endTs={win.endTs}
        windowText={windowText}
        granText={granText}
        keys={keys}
        groupOptions={groupOptions}
        modelOptions={modelData.map((m) => m.model)}
        canZoomBack={zoomStack.length > 0}
        onTime={setTime}
        onPatch={patchUrl}
        onZoomBack={zoomBack}
        onReset={() => {
          setZoomStack([])
          resetUrl()
        }}
      />
      <KpiCards
        stats={rangeStats}
        activeKeys={overviewQuery.data?.activeClientKeys ?? 0}
        activeCredentials={overviewQuery.data?.activeCredentials ?? 0}
      />
      <TrendCard
        metric={metric}
        onMetricChange={(m) => patchUrl({ m })}
        seriesData={seriesData}
        win={win}
        granText={granText}
        onZoom={zoomTo}
        loading={seriesQuery.isLoading}
      />
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <ModelPanel data={modelData} selectedModel={url.model} onSelect={(m) => toggle('model', m)} />
        <CredentialPanel data={credData} />
      </div>
      <KeyPanel data={keyData} selectedKey={url.key} onSelect={(id) => toggle('key', id)} />
    </div>
  )
}

// ============ 筛选栏 ============

function FilterBar({
  url,
  period,
  gMode,
  startTs,
  endTs,
  windowText,
  granText,
  keys,
  groupOptions,
  modelOptions,
  canZoomBack,
  onTime,
  onPatch,
  onZoomBack,
  onReset,
}: {
  url: UrlState
  period: StatsPeriod
  gMode: GranularityMode
  startTs: number
  endTs: number
  windowText: string
  granText: string
  keys: ClientKeyItem[]
  groupOptions: string[]
  modelOptions: string[]
  canZoomBack: boolean
  onTime: (next: Partial<TimeState>) => void
  onPatch: (next: Partial<UrlState>) => void
  onZoomBack: () => void
  onReset: () => void
}) {
  // 当前选中的模型在新时间窗里可能没数据，仍保留在选项里避免 Select 显示空白
  const models =
    url.model !== 'all' && !modelOptions.includes(url.model) ? [url.model, ...modelOptions] : modelOptions
  const keyName = keys.find((k) => String(k.id) === url.key)?.name ?? `#${url.key}`
  const chips = [
    url.key !== 'all' && { label: `Key：${keyName}`, clear: () => onPatch({ key: 'all' }) },
    url.group !== 'all' && { label: `分组：${url.group}`, clear: () => onPatch({ group: 'all' }) },
    url.model !== 'all' && { label: `模型：${url.model}`, clear: () => onPatch({ model: 'all' }) },
  ].filter(Boolean) as { label: string; clear: () => void }[]
  const isDefault = Object.entries(URL_DEFAULTS).every(
    ([k, v]) => k === 'm' || url[k as keyof UrlState] === v,
  )

  return (
    <Card className="sticky -top-4 z-10 mb-5 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:-top-6 lg:-top-7">
      <CardContent className="space-y-3 p-3 sm:p-4">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="radiogroup"
              aria-label="时间范围"
              className="flex flex-wrap items-center gap-0.5 rounded-md border border-border/60 bg-muted/40 p-0.5"
            >
              {PERIODS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  role="radio"
                  aria-checked={period === p.value}
                  onClick={() => onTime({ p: p.value, from: '', to: '' })}
                  className={cn(
                    'h-7 rounded px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
                    period === p.value && 'bg-background text-foreground shadow-sm',
                  )}
                >
                  {p.label}
                </button>
              ))}
              <span
                className={cn(
                  'h-7 rounded px-2.5 text-xs font-medium leading-7 text-muted-foreground',
                  period === 'custom' && 'bg-background text-foreground shadow-sm',
                )}
              >
                自定义
              </span>
            </div>
            <Select value={gMode} onValueChange={(g) => onTime({ g })}>
              <SelectTrigger aria-label="聚合粒度" className="h-8 w-[108px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRANULARITY_OPTIONS.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canZoomBack && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onZoomBack}>
                <Undo2 className="!size-3.5" />
                返回上一步
              </Button>
            )}
          </div>
          {/* key 绑定当前窗口：预设切换或框选后，草稿自动同步为实际查询的区间 */}
          <CustomRangeForm
            key={`${startTs}-${endTs}`}
            startTs={startTs}
            endTs={endTs}
            onApply={(from, to) => onTime({ p: 'custom', from, to })}
          />
        </div>

        <div className="flex flex-col gap-2 border-t border-border/50 pt-3 lg:flex-row lg:items-center">
          <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            维度
          </div>
          <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3 lg:max-w-[640px]">
            <Select value={url.key} onValueChange={(key) => onPatch({ key })}>
              <SelectTrigger aria-label="入口 Key 筛选" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部入口 Key</SelectItem>
                {keys.map((k) => (
                  <SelectItem key={k.id} value={String(k.id)}>
                    {k.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={url.group} onValueChange={(group) => onPatch({ group })}>
              <SelectTrigger aria-label="分组筛选" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部分组</SelectItem>
                {groupOptions.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={url.model} onValueChange={(model) => onPatch({ model })}>
              <SelectTrigger aria-label="模型筛选" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部模型</SelectItem>
                {models.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 lg:justify-end">
            <span className="font-mono text-[11px] text-muted-foreground">
              {windowText} · {granText}
            </span>
            {chips.map((c) => (
              <Badge key={c.label} variant="secondary" className="max-w-[220px] gap-1 pr-1 text-[11px]">
                <span className="truncate">{c.label}</span>
                <button
                  type="button"
                  aria-label={`清除${c.label}`}
                  onClick={c.clear}
                  className="rounded p-0.5 hover:bg-foreground/10"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {!isDefault && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onReset}>
                <RotateCcw className="!size-3.5" />
                重置
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function CustomRangeForm({
  startTs,
  endTs,
  onApply,
}: {
  startTs: number
  endTs: number
  onApply: (from: string, to: string) => void
}) {
  const [from, setFrom] = useState(() => toLocalInput(new Date(startTs * 1000)))
  const [to, setTo] = useState(() => toLocalInput(new Date(endTs * 1000)))
  const min = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - RETENTION_DAYS)
    return toLocalInput(d)
  }, [])
  const invalid = !from || !to || to <= from
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!invalid) onApply(from, to)
      }}
    >
      <Input
        type="datetime-local"
        aria-label="开始时间"
        step={3600}
        min={min}
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        className="h-8 w-[190px] text-xs"
      />
      <span className="text-xs text-muted-foreground">至</span>
      <Input
        type="datetime-local"
        aria-label="结束时间（不含）"
        step={3600}
        min={min}
        value={to}
        onChange={(e) => setTo(e.target.value)}
        className="h-8 w-[190px] text-xs"
      />
      <Button
        type="submit"
        size="sm"
        className="h-8 px-3 text-xs"
        disabled={invalid}
        title={`统计数据保留最近 ${RETENTION_DAYS} 天；起止时间会对齐到整点 / 整天`}
      >
        查询
      </Button>
    </form>
  )
}

// ============ 指标卡片 ============

interface RangeStats {
  calls: number
  credits: number
  errors: number
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

function aggregateSeries(data: TimeSeriesPoint[]): RangeStats {
  return data.reduce(
    (acc, p) => ({
      calls: acc.calls + p.calls,
      credits: acc.credits + (p.credits ?? 0),
      errors: acc.errors + p.errors,
      inputTokens: acc.inputTokens + p.inputTokens,
      outputTokens: acc.outputTokens + p.outputTokens,
      cacheCreationTokens: acc.cacheCreationTokens + (p.cacheCreationTokens ?? 0),
      cacheReadTokens: acc.cacheReadTokens + (p.cacheReadTokens ?? 0),
    }),
    { calls: 0, credits: 0, errors: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
  )
}

const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0)

function KpiCards({
  stats,
  activeKeys,
  activeCredentials,
}: {
  stats: RangeStats
  activeKeys: number
  activeCredentials: number
}) {
  // inputTokens 只是未命中缓存的部分；总输入 = 未缓存 + 缓存写 + 缓存读
  const totalInput = stats.inputTokens + stats.cacheCreationTokens + stats.cacheReadTokens
  const totalTokens = totalInput + stats.outputTokens
  const hitRate = pct(stats.cacheReadTokens, totalInput)
  const successRate = pct(stats.calls - stats.errors, stats.calls)
  const perCall = (v: number) => (stats.calls > 0 ? v / stats.calls : 0)

  return (
    <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <KpiCard
        icon={<Activity />}
        label="调用"
        value={formatNumber(stats.calls)}
        sub={
          stats.calls > 0 ? (
            <span className={cn(stats.errors > 0 && 'text-destructive')}>
              成功率 {successRate.toFixed(1)}% · 异常 {formatNumber(stats.errors)}
            </span>
          ) : (
            '暂无调用'
          )
        }
      />
      <KpiCard
        icon={<Coins />}
        label="Credit"
        value={formatCredits(stats.credits)}
        sub={`单次均值 ${formatCredits(perCall(stats.credits))}`}
        accent
      />
      <KpiCard
        icon={<Zap />}
        label="总 Token"
        value={formatNumber(totalTokens)}
        sub={`输入 ${formatNumber(totalInput)} · 输出 ${formatNumber(stats.outputTokens)}`}
      />
      <KpiCard
        icon={<Cpu />}
        label="输入 Token（含缓存）"
        value={formatNumber(totalInput)}
        sub={
          <div className="space-y-1">
            <div>
              缓存命中 {hitRate.toFixed(1)}% · 写 {formatNumber(stats.cacheCreationTokens)}
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full rounded-full bg-cyan-500" style={{ width: `${hitRate}%` }} />
            </div>
          </div>
        }
      />
      <KpiCard
        icon={<Cpu />}
        label="输出 Token"
        value={formatNumber(stats.outputTokens)}
        sub={`单次均值 ${formatNumber(Math.round(perCall(stats.outputTokens)))}`}
      />
      <KpiCard
        icon={<KeyRound />}
        label="启用的客户端 Key"
        value={formatNumber(activeKeys)}
        sub={`可用上游凭据 ${formatNumber(activeCredentials)}`}
      />
    </div>
  )
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: React.ReactNode
  accent?: boolean
}) {
  return (
    <Card className={cn('transition-colors hover:border-primary/30', accent && 'border-primary/30')}>
      <CardContent className="p-3.5 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-primary [&_svg]:size-3.5">
            {icon}
          </span>
        </div>
        <div className="mt-2 truncate font-mono text-xl font-semibold tabular-nums text-foreground sm:text-2xl">
          {value}
        </div>
        {sub && <div className="mt-1 text-[11px] leading-4 text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  )
}

// ============ 趋势 ============

function TrendCard({
  metric,
  onMetricChange,
  seriesData,
  win,
  granText,
  onZoom,
  loading,
}: {
  metric: TrendMetric
  onMetricChange: (m: TrendMetric) => void
  seriesData: TimeSeriesPoint[]
  win: { startTs: number; endTs: number; granularity: 'hour' | 'day' }
  granText: string
  onZoom: (startTs: number, endTs: number) => void
  loading: boolean
}) {
  return (
    <Card className="mb-6">
      <CardContent className="p-4 sm:p-5">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight">使用趋势</h2>
            <p className="text-[12px] text-muted-foreground">
              {granText}聚合 · 在图上拖拽框选可放大该时段
              {win.granularity === 'day' && '，单击某天查看小时明细'} · 点击图例隐藏系列
            </p>
          </div>
          <div
            role="tablist"
            aria-label="趋势指标"
            className="flex shrink-0 items-center gap-0.5 self-start rounded-md border border-border/60 bg-muted/40 p-0.5"
          >
            {METRICS.map((m) => (
              <button
                key={m.value}
                type="button"
                role="tab"
                aria-selected={metric === m.value}
                onClick={() => onMetricChange(m.value)}
                className={cn(
                  'h-7 rounded px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
                  metric === m.value && 'bg-background text-foreground shadow-sm',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <div className="h-[280px] animate-pulse rounded-md bg-muted/40 sm:h-[340px]" />
        ) : (
          <TimeSeriesChart
            key={metric}
            data={seriesData}
            granularity={win.granularity}
            startTs={win.startTs}
            endTs={win.endTs}
            metric={metric}
            onRangeSelect={onZoom}
          />
        )}
      </CardContent>
    </Card>
  )
}

// ============ 分布 ============

/** 可点击的表格行：点击 / 回车切换筛选 */
function rowProps(active: boolean, onSelect: () => void) {
  return {
    tabIndex: 0,
    role: 'button',
    'aria-pressed': active,
    onClick: onSelect,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect()
      }
    },
    className: cn(
      'cursor-pointer border-t border-border/40 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/60',
      active && 'bg-primary/10 font-medium hover:bg-primary/15',
    ),
  }
}

function ShareBar({ value, color = 'bg-primary/60' }: { value: number; color?: string }) {
  return (
    <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className={cn('h-full rounded-full', color)} style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  )
}

function ModelPanel({
  data,
  selectedModel,
  onSelect,
}: {
  data: ModelDistribution[]
  selectedModel: string
  onSelect: (model: string) => void
}) {
  const totalCredits = data.reduce((s, m) => s + m.credits, 0)
  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold tracking-tight">按模型分布</h2>
          <span className="text-[11px] text-muted-foreground">点击行按模型筛选</span>
        </div>
        <ModelPieChart data={data} />
        {data.length > 0 && (
          <div className="mt-3 max-h-64 overflow-auto text-[12px]">
            <table className="w-full min-w-[460px]">
              <thead className="sticky top-0 bg-card text-muted-foreground">
                <tr>
                  <th className="pb-1 text-left font-medium">模型</th>
                  <th className="text-right font-medium">调用</th>
                  <th className="text-right font-medium" title="未缓存 + 缓存写 + 缓存读">总输入</th>
                  <th className="text-right font-medium" title="缓存读 / 总输入">命中率</th>
                  <th className="text-right font-medium">输出</th>
                  <th className="w-[88px] pl-3 text-right font-medium">Credit</th>
                </tr>
              </thead>
              <tbody>
                {data.map((m) => {
                  const totalInput = m.inputTokens + m.cacheCreationTokens + m.cacheReadTokens
                  return (
                    <tr key={m.model} {...rowProps(m.model === selectedModel, () => onSelect(m.model))}>
                      <td className="max-w-[200px] truncate py-1.5" title={m.model}>
                        {m.model}
                      </td>
                      <td className="text-right tabular-nums">
                        {formatNumber(m.calls)}
                        {m.errors > 0 && <span className="ml-1 text-destructive">({formatNumber(m.errors)})</span>}
                      </td>
                      <td
                        className="text-right tabular-nums"
                        title={`未缓存 ${formatNumber(m.inputTokens)} · 缓存写 ${formatNumber(m.cacheCreationTokens)} · 缓存读 ${formatNumber(m.cacheReadTokens)}`}
                      >
                        {formatNumber(totalInput)}
                      </td>
                      <td className="text-right tabular-nums">
                        {totalInput > 0 ? `${pct(m.cacheReadTokens, totalInput).toFixed(1)}%` : '-'}
                      </td>
                      <td className="text-right tabular-nums">{formatNumber(m.outputTokens)}</td>
                      <td className="pl-3 text-right tabular-nums">
                        {formatCredits(m.credits)}
                        <ShareBar value={pct(m.credits, totalCredits)} color="bg-pink-500/70" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CredentialPanel({ data }: { data: CredentialDistribution[] }) {
  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">按上游凭据分布</h2>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Server className="h-3 w-3" />
            Top {Math.min(data.length, 12)}
          </span>
        </div>
        <CredentialBarChart data={data} />
      </CardContent>
    </Card>
  )
}

function KeyPanel({
  data,
  selectedKey,
  onSelect,
}: {
  data: KeyDistribution[]
  selectedKey: string
  onSelect: (keyId: string) => void
}) {
  const totalCredits = data.reduce((s, k) => s + k.credits, 0)
  return (
    <Card className="mb-6">
      <CardContent className="p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight">按入口 Key 分布</h2>
            <p className="text-[12px] text-muted-foreground">
              横向对比全部 Key（不受 Key 筛选影响）· 点击行按 Key 筛选
            </p>
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <KeyRound className="h-3 w-3" />
            Top {Math.min(data.length, 12)}
          </span>
        </div>
        <KeyBarChart data={data} />
        {data.length > 0 && (
          <div className="mt-3 max-h-64 overflow-auto text-[12px]">
            <table className="w-full min-w-[460px]">
              <thead className="sticky top-0 bg-card text-muted-foreground">
                <tr>
                  <th className="pb-1 text-left font-medium">Key</th>
                  <th className="text-right font-medium">调用</th>
                  <th className="text-right font-medium">总输入</th>
                  <th className="text-right font-medium">输出</th>
                  <th className="text-right font-medium">异常</th>
                  <th className="w-[88px] pl-3 text-right font-medium">Credit</th>
                </tr>
              </thead>
              <tbody>
                {data.map((k) => (
                  <tr key={k.keyId} {...rowProps(String(k.keyId) === selectedKey, () => onSelect(String(k.keyId)))}>
                    <td className="max-w-[220px] truncate py-1.5" title={k.name}>
                      {k.name}
                    </td>
                    <td className="text-right tabular-nums">{formatNumber(k.calls)}</td>
                    <td className="text-right tabular-nums">
                      {formatNumber(k.inputTokens + k.cacheCreationTokens + k.cacheReadTokens)}
                    </td>
                    <td className="text-right tabular-nums">{formatNumber(k.outputTokens)}</td>
                    <td className={cn('text-right tabular-nums', k.errors > 0 && 'text-destructive')}>
                      {formatNumber(k.errors)}
                    </td>
                    <td className="pl-3 text-right tabular-nums">
                      {formatCredits(k.credits)}
                      <ShareBar value={pct(k.credits, totalCredits)} color="bg-pink-500/70" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
