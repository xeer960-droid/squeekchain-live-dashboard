import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type DashboardState = {
  status: Record<string, any> | null;
  core: Record<string, any> | null;
  events: Record<string, any> | null;
  stats: Record<string, any> | null;
  error: string | null;
  isLoading: boolean;
  lastUpdated: string | null;
};

type StatCardProps = {
  label: string;
  value: string;
  hint?: string;
  status?: 'ok' | 'warn' | 'muted';
};

const API_BASE = 'https://api.squeekchain.com/v1';

const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'string' ? Number(value) : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const formatNumber = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === '') return 'Unknown';
  const parsed = asNumber(value);
  if (parsed === null) return String(value);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(parsed);
};

const formatCompact = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === '') return 'Unknown';
  const parsed = asNumber(value);
  if (parsed === null) return String(value);
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(parsed);
};

const formatPercent = (bps: string | number | null | undefined) => {
  const parsed = asNumber(bps);
  if (parsed === null) return 'Unknown';
  return `${(parsed / 100).toFixed(2)}%`;
};

const formatDateTime = (iso: string | null | undefined) => {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const parseStatus = (statusData: Record<string, any> | null) => {
  if (!statusData) return 'Unknown';
  if (statusData.status === 'unavailable') return statusData.reason || 'Unavailable';
  if (statusData.builder?.status === 'unavailable') return statusData.builder.reason || 'Builder unavailable';
  if (statusData.oracle?.state === 'unavailable') return statusData.oracle.reason || 'Oracle unavailable';
  if (statusData.settlementQueue?.status === 'unavailable') return statusData.settlementQueue.reason || 'Queue unavailable';
  return 'Live';
};

const getStatusColor = (state: string) => {
  if (state === 'Live') return '#4ade80';
  if (state === 'Unknown' || state === 'Unavailable') return '#fbbf24';
  return '#f87171';
};

const fetchJson = async <T,>(path: string): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${path}: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
};

function App() {
  const [dashboard, setDashboard] = useState<DashboardState>({
    status: null,
    core: null,
    events: null,
    stats: null,
    error: null,
    isLoading: true,
    lastUpdated: null,
  });

  useEffect(() => {
    let active = true;

    const load = async () => {
      setDashboard((current) => ({ ...current, isLoading: true }));
      try {
        const [status, core, events, stats] = await Promise.all([
          fetchJson<Record<string, any>>('/status').catch(() => null),
          fetchJson<Record<string, any>>('/core').catch(() => null),
          fetchJson<Record<string, any>>('/events?limit=20').catch(() => null),
          fetchJson<Record<string, any>>('/measurement/stats?range=7d').catch(() => null),
        ]);

        if (!active) return;

        const hasAnyData = Boolean(status || core || events || stats);
        setDashboard({
          status,
          core,
          events,
          stats,
          error: hasAnyData ? null : 'No data available from the Squeekchain API.',
          isLoading: false,
          lastUpdated: new Date().toISOString(),
        });
      } catch (error) {
        if (!active) return;
        setDashboard((current) => ({
          ...current,
          error: error instanceof Error ? error.message : 'Unable to reach the Squeekchain API.',
          isLoading: false,
        }));
      }
    };

    load();
    const interval = window.setInterval(load, 15000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const statusData = dashboard.status;
  const coreData = dashboard.core;
  const builder = statusData?.builder;
  const builderAnchor = builder?.anchor ?? coreData?.core ?? null;
  const measurement = statusData?.measurement ?? null;
  const oracle = statusData?.oracle ?? null;
  const queue = statusData?.settlementQueue ?? null;
  const activeEvents = (dashboard.events?.events ?? []) as Record<string, any>[];
  const stats = dashboard.stats;
  const summary = stats?.activity?.summary ?? {};
  const lifetime = stats?.lifetime ?? {};
  const dailyActivity = (stats?.activity?.days ?? []) as Record<string, any>[];
  const blocksStatus = stats?.blocks?.status ?? 'unknown';
  const coverageBps = asNumber(stats?.activity?.coverage?.coverageBps ?? summary?.coverageBps ?? null);
  const throughputWorkUnits = asNumber(summary?.observedWorkUnits ?? lifetime?.acceptedWorkUnits ?? null);
  const throughputDistance = asNumber(summary?.observedDistanceMm ?? lifetime?.observedDistanceMm ?? null);

  const performanceTrend = useMemo(() => {
    return dailyActivity.map((day, index) => ({
      name: day.date ? new Date(day.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : `D${index + 1}`,
      work: asNumber(day.observedWorkUnits) ?? 0,
      distance: asNumber(day.distanceMm) ?? 0,
    }));
  }, [dailyActivity]);

  const eventCategories = useMemo(() => {
    const byType: Record<string, number> = {};
    for (const event of activeEvents) {
      const type = event.type ?? 'unknown';
      byType[type] = (byType[type] ?? 0) + 1;
    }
    return Object.entries(byType).map(([name, value]) => ({ name, value }));
  }, [activeEvents]);

  const blockChart = useMemo(() => {
    if (!stats?.blocks || stats.blocks.status === 'unavailable') return [];
    const rows = stats.blocks.days ?? [];
    return rows.map((day: Record<string, any>) => ({
      date: day.date ?? '—',
      completed: asNumber(day.completed) ?? 0,
      total: asNumber(day.total) ?? 0,
    }));
  }, [stats]);

  const settledBlockHeight =
    asNumber(coreData?.core?.blockHeight) ??
    asNumber(builderAnchor?.blockHeight) ??
    asNumber(statusData?.builder?.anchor?.blockHeight) ??
    null;

  const nextBlockProgress =
    asNumber(builderAnchor?.blockProgress) ??
    asNumber(coreData?.core?.blockProgress) ??
    asNumber(statusData?.builder?.anchor?.blockProgress) ??
    null;

  const pipelineStatus = parseStatus(statusData);
  const statusColor = getStatusColor(pipelineStatus);

  const showUnavailableChart = blocksStatus === 'unavailable' || !blockChart.length;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Public pipeline status</p>
          <h1>Squeekchain Live Dashboard</h1>
        </div>
        <div className="header-meta">
          <span className="status-dot" style={{ background: statusColor }} />
          <span>{pipelineStatus}</span>
          {dashboard.lastUpdated ? (
            <small>Updated {formatDateTime(dashboard.lastUpdated)}</small>
          ) : (
            <small>{dashboard.isLoading ? 'Loading live data…' : 'Waiting for live data…'}</small>
          )}
        </div>
      </header>

      {dashboard.error ? (
        <div className="notice error">
          <strong>Data unavailable:</strong> {dashboard.error}
        </div>
      ) : null}

      <main className="dashboard-grid">
        <section className="panel hero-panel">
          <div className="hero-copy">
            <span className="section-label">Live pipeline</span>
            <h2>{pipelineStatus}</h2>
            <p>
              {measurement?.freshness === 'online'
                ? 'Telemetry is current and the builder queue is processing live measurement data.'
                : 'The latest measurement is stale or unavailable; the dashboard is showing the last known public state.'}
            </p>
          </div>
          <div className="metric-stack">
            <StatCard
              label="Settled block height"
              value={settledBlockHeight === null ? 'Unknown' : formatNumber(settledBlockHeight)}
              hint={settledBlockHeight === null ? 'No reliable core height reported' : 'Safe chain view'}
              status={settledBlockHeight === null ? 'warn' : 'ok'}
            />
            <StatCard
              label="Next block progress"
              value={nextBlockProgress === null ? 'Unknown' : `${formatNumber(nextBlockProgress)} / 1,000,000,000`}
              hint={nextBlockProgress === null ? 'No reliable block progress reported' : 'Block units into the next block'}
              status={nextBlockProgress === null ? 'warn' : 'ok'}
            />
          </div>
        </section>

        <StatCard
          label="Latest accepted measurement"
          value={measurement?.receivedAt ? formatDateTime(measurement.receivedAt) : 'Unknown'}
          hint={measurement ? `Freshness: ${measurement.freshness ?? 'unknown'} • Work: ${formatCompact(measurement.cumulativeWorkUnits ?? '0')}` : 'No accepted measurement reported'}
          status={measurement?.freshness === 'online' ? 'ok' : 'warn'}
        />

        <StatCard
          label="Safe chain height"
          value={coreData?.chain?.safeThroughBlock ? formatNumber(coreData.chain.safeThroughBlock) : 'Unknown'}
          hint={coreData?.chain?.target ? `Target: ${coreData.chain.target}` : 'No safe chain data'}
          status={coreData?.status === 'available' ? 'ok' : 'muted'}
        />

        <StatCard
          label="Oracle state"
          value={oracle?.state ? String(oracle.state) : 'Unknown'}
          hint={oracle?.state === 'accepted' && oracle?.latestClosure ? `Latest closure: ${oracle.latestClosure.roundCount ?? 0} rounds` : oracle?.reason || 'No oracle closure'}
          status={oracle?.state === 'accepted' ? 'ok' : 'warn'}
        />

        <StatCard
          label="Settlement queue"
          value={queue?.state ? String(queue.state) : 'Unknown'}
          hint={queue?.buffered ? `Buffered: ${queue.buffered.roundCount ?? 0} rounds` : queue?.reason || 'No buffered work'}
          status={queue?.state === 'ready' ? 'ok' : 'warn'}
        />

        <section className="panel span-2">
          <div className="panel-header">
            <div>
              <span className="section-label">Network activity</span>
              <h3>7-day throughput</h3>
            </div>
          </div>
          <div className="chart-wrap">
            {performanceTrend.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={performanceTrend}>
                  <defs>
                    <linearGradient id="workFill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="5%" stopColor="#7dd3fc" stopOpacity={0.6} />
                      <stop offset="95%" stopColor="#7dd3fc" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false} />
                  <XAxis dataKey="name" stroke="#94a3b8" tickLine={false} axisLine={false} minTickGap={20} />
                  <YAxis stroke="#94a3b8" tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: '#0f172a',
                      border: '1px solid rgba(148,163,184,0.2)',
                      borderRadius: 12,
                    }}
                  />
                  <Area type="monotone" dataKey="work" stroke="#7dd3fc" fill="url(#workFill)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state">No 7-day activity data available.</div>
            )}
          </div>
        </section>

        <section className="panel span-2">
          <div className="panel-header">
            <div>
              <span className="section-label">Distribution</span>
              <h3>Recent event mix</h3>
            </div>
          </div>
          <div className="chart-wrap">
            {eventCategories.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={eventCategories}>
                  <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false} />
                  <XAxis dataKey="name" stroke="#94a3b8" tickLine={false} axisLine={false} />
                  <YAxis stroke="#94a3b8" tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: '#0f172a',
                      border: '1px solid rgba(148,163,184,0.2)',
                      borderRadius: 12,
                    }}
                  />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                    {eventCategories.map((entry, index) => (
                      <Cell key={`${entry.name}-${index}`} fill={['#7dd3fc', '#c084fc', '#34d399', '#fbbf24', '#fca5a5'][index % 5]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state">No event distribution data available.</div>
            )}
          </div>
        </section>

        <section className="panel span-2">
          <div className="panel-header">
            <div>
              <span className="section-label">Settlements</span>
              <h3>Block completion trend</h3>
            </div>
          </div>
          <div className="chart-wrap">
            {showUnavailableChart ? (
              <div className="empty-state">Block completion data is unavailable from the live API.</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={blockChart}>
                  <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false} />
                  <XAxis dataKey="date" stroke="#94a3b8" tickLine={false} axisLine={false} minTickGap={20} />
                  <YAxis stroke="#94a3b8" tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: '#0f172a',
                      border: '1px solid rgba(148,163,184,0.2)',
                      borderRadius: 12,
                    }}
                  />
                  <Bar dataKey="completed" barSize={18} fill="#34d399" radius={[8, 8, 0, 0]} />
                  <Line type="monotone" dataKey="total" stroke="#7dd3fc" strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="panel span-3">
          <div className="panel-header">
            <div>
              <span className="section-label">Recent feed</span>
              <h3>Latest events</h3>
            </div>
          </div>
          <ul className="event-list">
            {activeEvents.length ? (
              activeEvents.slice(0, 8).map((event) => {
                const type = event.type ?? 'unknown';
                const payload = event.payload ?? {};
                const firstValue = Object.values(payload as Record<string, any>)[0];
                return (
                  <li key={event.id ?? `${type}-${event.occurredAt}`} className="event-item">
                    <div className="event-badge">{type}</div>
                    <div className="event-content">
                      <strong>{type.replace(/_/g, ' ')}</strong>
                      <span>{typeof firstValue === 'string' || typeof firstValue === 'number' ? String(firstValue) : 'Public event'}</span>
                    </div>
                    <time>{formatDateTime(event.occurredAt)}</time>
                  </li>
                );
              })
            ) : (
              <li className="event-item empty">
                <div className="event-content">
                  <strong>No recent events</strong>
                  <span>The public event feed is empty or currently unavailable.</span>
                </div>
              </li>
            )}
          </ul>
        </section>

        <section className="panel span-3">
          <div className="panel-header">
            <div>
              <span className="section-label">Summary</span>
              <h3>7-day overview</h3>
            </div>
          </div>
          <div className="summary-grid">
            <div>
              <label>Accepted work units</label>
              <strong>{throughputWorkUnits === null ? 'Unknown' : formatCompact(throughputWorkUnits)}</strong>
            </div>
            <div>
              <label>Observed distance</label>
              <strong>{throughputDistance === null ? 'Unknown' : `${formatCompact(throughputDistance)} mm`}</strong>
            </div>
            <div>
              <label>Active days</label>
              <strong>{summary.activeDayCount ?? lifetime.activeDayCount ?? 'Unknown'}</strong>
            </div>
            <div>
              <label>Coverage</label>
              <strong>{coverageBps === null ? 'Unknown' : formatPercent(coverageBps)}</strong>
            </div>
            <div>
              <label>Settled blocks</label>
              <strong>{lifetime.settledBlockCount ? formatNumber(lifetime.settledBlockCount) : '0'}</strong>
            </div>
            <div>
              <label>Settlement count</label>
              <strong>{lifetime.settlementCount ? formatNumber(lifetime.settlementCount) : '0'}</strong>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function StatCard({ label, value, hint, status = 'ok' }: StatCardProps) {
  return (
    <article className={`stat-card ${status}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </article>
  );
}

export default App;
