import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Eye, EyeOff, ShieldCheck, Truck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";

type Period = "current" | "six" | "three-months";
type Tone = "blue" | "green" | "amber" | "red" | "violet" | "slate";
interface Metric {
  label: string;
  value: string;
  detail: string;
  tone: Tone;
}
interface TrendSeries {
  label: string;
  color: string;
  values: Array<number | null>;
  format?: (value: number) => string;
}
interface OperationsPayload {
  tenant?: { id: string; name: string };
  generatedAt: string;
  performance: {
    period: string;
    history: Array<{
      period: string;
      overallScore: number | null;
      overallStanding?: string | null;
      averageDaScore?: number;
      pod: number;
      dcr: number;
      cdf: number;
      packages: number;
      activeDrivers: number;
    }>;
    dspPerformance: {
      overallScore: number | null;
      deliveryScore: number;
      safetyScore: number;
      qualityScore: number;
      driverCount: number;
      totalDeliveries: number;
    };
  };
  fleet: {
    asOf?: string;
    summary?: {
      registeredFleet?: number;
      operational?: number;
      grounded?: number;
      ready?: number;
    };
    vehicles?: Array<{ status?: string; ownership?: string }>;
  };
  costs: {
    asOf?: string;
    needsData?: boolean;
    summary?: {
      threeMonthAmazonCoverage?: number;
      threeMonthIncludedCost?: number;
      threeMonthDifference?: number;
    };
  };
  connections: {
    summary?: { connected?: number; connectionTotal?: number };
    connections?: Array<{
      id: string;
      name?: string;
      displayName?: string;
      status: string;
      lastSuccessAt?: string | null;
      kind?: string;
      authKind?: string;
    }>;
  };
  sources: Array<{
    id: string;
    label: string;
    asOf?: string | null;
    status: string;
    feeds?: string[];
  }>;
}

const toneClasses: Record<Tone, string> = {
  blue: "bg-blue-50 text-blue-700 ring-blue-100",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  amber: "bg-amber-50 text-amber-700 ring-amber-100",
  red: "bg-red-50 text-red-700 ring-red-100",
  violet: "bg-violet-50 text-violet-700 ring-violet-100",
  slate: "bg-slate-50 text-slate-700 ring-slate-100",
};

const MetricCard: React.FC<{ metric: Metric }> = ({ metric }) => (
  <article className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-100">
    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
      {metric.label}
    </p>
    <p
      className={`mt-3 inline-flex rounded-lg px-2.5 py-1 text-2xl font-bold ring-1 ${toneClasses[metric.tone]}`}
    >
      {metric.value}
    </p>
    <p className="mt-3 text-sm leading-5 text-gray-500">{metric.detail}</p>
  </article>
);
const SectionHeading: React.FC<{ title: string; subtitle: string }> = ({
  title,
  subtitle,
}) => (
  <div className="mb-4 mt-8 flex flex-wrap items-end justify-between gap-2">
    <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
    <p className="text-sm text-gray-500">{subtitle}</p>
  </div>
);

const TrendChart: React.FC<{
  title: string;
  labels: string[];
  series: TrendSeries[];
}> = ({ title, labels, series }) => {
  const [activePoint, setActivePoint] = useState<{
    x: number;
    y: number;
    period: string;
    series: string;
    value: string;
    color: string;
  } | null>(null);
  const chartFrameRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(640);
  const chartHeight = 224;
  useEffect(() => {
    const frame = chartFrameRef.current;
    if (!frame) return;
    const updateWidth = () =>
      setChartWidth(
        Math.max(280, Math.round(frame.getBoundingClientRect().width)),
      );
    updateWidth();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  const values = series
    .flatMap((item) => item.values)
    .filter(
      (value): value is number => value != null && Number.isFinite(value),
    );
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const isPercent = series.some((item) => item.format?.(100).includes("%"));
  const singleValuePadding = isPercent
    ? 0.25
    : Math.max(Math.abs(rawMax) * 0.05, 1);
  const min = rawMin === rawMax ? rawMin - singleValuePadding : rawMin;
  const max = rawMin === rawMax ? rawMax + singleValuePadding : rawMax;
  const range = max - min;
  const midpoint = min + range / 2;
  const xFor = (index: number) =>
    labels.length === 1
      ? chartWidth / 2
      : 12 + (index / (labels.length - 1)) * (chartWidth - 24);
  const yFor = (value: number) => 184 - ((value - min) / range) * 144;
  const pointSegments = (items: Array<number | null>) => {
    const segments: string[][] = [];
    items.forEach((value, index) => {
      if (value == null || !Number.isFinite(value)) return;
      if (index === 0 || items[index - 1] == null) segments.push([]);
      segments.at(-1)?.push(`${xFor(index)},${yFor(value)}`);
    });
    return segments
      .filter((segment) => segment.length > 1)
      .map((segment) => segment.join(" "));
  };
  const formatAxisValue = (value: number) => {
    if (series[0]?.format) return series[0].format(value);
    return value.toLocaleString(undefined, {
      maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
    });
  };

  return (
    <article className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-100">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <p className="mt-1 text-[11px] text-gray-400">
            Hover or focus a point for exact values
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-gray-500">
          {series.map((item) => (
            <span key={item.label} className="flex items-center gap-1.5">
              <i
                className="h-2 w-2 rounded-full"
                style={{ background: item.color }}
              />
              {item.label}
            </span>
          ))}
        </div>
      </div>
      <div className="relative mt-4 pl-14">
        {[
          { value: max, top: "18%" },
          { value: midpoint, top: "50%" },
          { value: min, top: "82%" },
        ].map((tick) => (
          <span
            key={tick.top}
            className="pointer-events-none absolute left-0 w-12 -translate-y-1/2 text-right text-[11px] font-medium tabular-nums text-gray-500"
            style={{ top: tick.top }}
          >
            {formatAxisValue(tick.value)}
          </span>
        ))}
        <div ref={chartFrameRef} className="h-56 w-full">
          <svg
            className="block h-56 w-full overflow-visible"
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            role="img"
            aria-label={`${title}. Use Tab to focus individual points for exact values.`}
          >
            {[40, 76, 112, 148, 184].map((y) => (
              <line
                key={y}
                x1="12"
                x2={chartWidth - 12}
                y1={y}
                y2={y}
                stroke="var(--chart-grid)"
                strokeWidth="1"
              />
            ))}
            {series.flatMap((item) =>
              pointSegments(item.values).map((points, index) => (
                <polyline
                  key={`${item.label}-${index}`}
                  points={points}
                  fill="none"
                  stroke={item.color}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )),
            )}
            {series.flatMap((item) =>
              item.values.map((value, index) => {
                if (value == null || !Number.isFinite(value)) return null;
                const x = xFor(index);
                const y = yFor(value);
                const formattedValue = item.format
                  ? item.format(value)
                  : value.toLocaleString();
                const point = {
                  x,
                  y,
                  period: labels[index],
                  series: item.label,
                  value: formattedValue,
                  color: item.color,
                };
                return (
                  <circle
                    key={`${item.label}-${index}`}
                    cx={x}
                    cy={y}
                    r="4"
                    fill={item.color}
                    stroke="var(--chart-point-border)"
                    strokeWidth="2"
                    tabIndex={0}
                    className="cursor-crosshair outline-none focus:stroke-gray-900 dark:focus:stroke-white"
                    aria-label={`${labels[index]}, ${item.label}: ${formattedValue}`}
                    onMouseEnter={() => setActivePoint(point)}
                    onMouseLeave={() => setActivePoint(null)}
                    onFocus={() => setActivePoint(point)}
                    onBlur={() => setActivePoint(null)}
                  >
                    <title>
                      {labels[index]} · {item.label}: {formattedValue}
                    </title>
                  </circle>
                );
              }),
            )}
          </svg>
        </div>
        {activePoint && (
          <div
            className="pointer-events-none absolute z-10 min-w-max rounded-lg bg-gray-950 px-3 py-2 text-xs text-white shadow-lg"
            style={{
              left: `calc(3.5rem + (100% - 3.5rem) * ${activePoint.x / chartWidth})`,
              top: `${(activePoint.y / chartHeight) * 100}%`,
              transform:
                activePoint.x / chartWidth > 0.76
                  ? "translate(-100%, -115%)"
                  : activePoint.x / chartWidth < 0.24
                    ? "translate(0, -115%)"
                    : "translate(-50%, -115%)",
            }}
          >
            <p className="font-medium text-gray-300">{activePoint.period}</p>
            <p className="mt-1 flex items-center gap-2">
              <i
                className="h-2 w-2 rounded-full"
                style={{ background: activePoint.color }}
              />
              <span>{activePoint.series}</span>
              <strong className="ml-1 tabular-nums">{activePoint.value}</strong>
            </p>
          </div>
        )}
      </div>
      <div
        className="ml-14 grid text-center text-[10px] text-gray-400"
        style={{
          gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))`,
        }}
      >
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </article>
  );
};

const Progress: React.FC<{
  label: string;
  value: number;
  max: number;
  color: string;
}> = ({ label, value, max, color }) => (
  <div>
    <div className="mb-1.5 flex justify-between text-sm">
      <span className="text-gray-600">{label}</span>
      <strong>{value}</strong>
    </div>
    <div className="h-2 rounded-full bg-gray-100">
      <div
        className={`h-2 rounded-full ${color}`}
        style={{ width: `${(value / max) * 100}%` }}
      />
    </div>
  </div>
);

const DashboardOverviewPage: React.FC = () => {
  const { data, isLoading, error, refetch } = useQuery<OperationsPayload>({
    queryKey: ["dashboard-operations"],
    queryFn: () => api.get("/dashboard/operations"),
    staleTime: 60_000,
  });
  const [period, setPeriod] = useState<Period>(
    () =>
      (localStorage.getItem("jec-kpi-period-view") as Period) || "three-months",
  );
  const [financialMasked, setFinancialMasked] = useState(
    () => localStorage.getItem("jec-mask-financial") === "1",
  );
  useEffect(
    () => localStorage.setItem("jec-kpi-period-view", period),
    [period],
  );
  useEffect(
    () =>
      localStorage.setItem("jec-mask-financial", financialMasked ? "1" : "0"),
    [financialMasked],
  );
  const start = period === "six" ? -6 : period === "three-months" ? -13 : -1;
  const history = data?.performance.history || [];
  const labels = useMemo(
    () =>
      history.slice(start).map((row) => row.period.replace(/^\d{4}-wk/, "W")),
    [history, start],
  );
  const currentWeek =
    data?.performance.period?.replace(/^\d{4}-wk/, "W") || "Latest";
  const latest = history[history.length - 1];
  const prior = history[history.length - 2];
  const delta = (value?: number, before?: number, suffix = "") =>
    value == null || before == null
      ? "Prior period unavailable"
      : `${value - before >= 0 ? "+" : ""}${(value - before).toFixed(2)}${suffix} from prior week`;
  const deliveryMetricsLive: Metric[] = [
    {
      label: `${currentWeek} DSP score`,
      value:
        data?.performance.dspPerformance.overallScore == null
          ? "—"
          : data.performance.dspPerformance.overallScore.toFixed(1),
      detail: "Official Amazon DSP scorecard overall standing",
      tone: "green",
    },
    {
      label: `${currentWeek} packages delivered`,
      value: latest?.packages.toLocaleString() || "—",
      detail: delta(latest?.packages, prior?.packages),
      tone: "blue",
    },
    {
      label: `${currentWeek} POD`,
      value: latest ? `${latest.pod.toFixed(2)}%` : "—",
      detail: delta(latest?.pod, prior?.pod, " pts"),
      tone: "green",
    },
    {
      label: `${currentWeek} CDF defects`,
      value: latest?.cdf.toLocaleString() || "—",
      detail: delta(latest?.cdf, prior?.cdf),
      tone: "amber",
    },
  ];
  const fleetVehicles = data?.fleet.vehicles || [];
  const fleetTotal =
    data?.fleet.summary?.registeredFleet || fleetVehicles.length;
  const operational =
    data?.fleet.summary?.operational ??
    fleetVehicles.filter((vehicle) =>
      ["active", "operational", "ready"].includes(
        String(vehicle.status).toLowerCase(),
      ),
    ).length;
  const grounded =
    data?.fleet.summary?.grounded ?? Math.max(0, fleetTotal - operational);
  const ownershipCounts = fleetVehicles.reduce<Record<string, number>>(
    (counts, vehicle) => {
      const key =
        String(vehicle.ownership || "Unclassified").trim() || "Unclassified";
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    },
    {},
  );
  const workforceMetricsLive: Metric[] = [
    {
      label: "Scorecard active drivers",
      value: String(latest?.activeDrivers ?? "—"),
      detail: `Amazon ${currentWeek} roster`,
      tone: "blue",
    },
    {
      label: "Fleet readiness",
      value: fleetTotal
        ? `${((operational / fleetTotal) * 100).toFixed(1)}%`
        : "—",
      detail: `${operational} operational · ${grounded} grounded`,
      tone: grounded ? "amber" : "green",
    },
    {
      label: "Connected sources",
      value: `${data?.connections.summary?.connected ?? 0} / ${data?.connections.summary?.connectionTotal ?? 0}`,
      detail: "Authenticated connectors reporting healthy; uploads excluded",
      tone: "green",
    },
  ];
  const costs = data?.costs.summary;
  const financialMetricsLive: Metric[] = [
    {
      label: "Fleet operating cost",
      value:
        costs?.threeMonthIncludedCost == null
          ? "—"
          : costs.threeMonthIncludedCost.toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
            }),
      detail: `Accounting evidence as of ${data?.costs.asOf || "unknown"}`,
      tone: "blue",
    },
    {
      label: "Amazon fleet coverage",
      value:
        costs?.threeMonthAmazonCoverage == null
          ? "—"
          : costs.threeMonthAmazonCoverage.toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
            }),
      detail: "Amazon reconciliation evidence",
      tone: "green",
    },
    {
      label: "Fleet difference",
      value:
        costs?.threeMonthDifference == null
          ? "—"
          : costs.threeMonthDifference.toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
            }),
      detail: data?.costs.needsData
        ? "Needs confirmed accounting upload"
        : "Coverage less cost",
      tone: (costs?.threeMonthDifference || 0) < 0 ? "red" : "green",
    },
  ];
  const viewLabel =
    period === "current"
      ? `${currentWeek} current view`
      : period === "six"
        ? `Trailing six weeks through ${currentWeek}`
        : `Trailing ${labels.length} weeks through ${currentWeek}`;
  if (isLoading)
    return (
      <div className="p-8 text-sm text-gray-500">
        Loading connected operational data…
      </div>
    );
  if (error || !data)
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">
        Connected operational data could not be loaded.{" "}
        <button className="underline" onClick={() => refetch()}>
          Retry
        </button>
      </div>
    );
  return (
    <div className="space-y-6 pb-10">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-600">
            Executive operating view
          </p>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">
            {data.tenant?.name || 'Amazon DSP'} KPI Dashboard
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Scorecard through {currentWeek} · assembled from connected sources{" "}
            {new Date(data.generatedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => setFinancialMasked((value) => !value)}
            aria-pressed={financialMasked}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {financialMasked ? <Eye size={16} /> : <EyeOff size={16} />}
            {financialMasked ? "Show financial data" : "Mask financial data"}
          </button>
          <div className="flex rounded-lg bg-gray-100 p-1 dark:bg-slate-800">
            {(
              [
                ["current", "Current"],
                ["six", "6 weeks"],
                ["three-months", "3 months"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPeriod(value)}
                className={`rounded-md px-3 py-2 text-sm font-medium ${period === value ? "bg-white text-gray-900 shadow-sm dark:bg-slate-700 dark:text-white" : "text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>
      <section className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <AlertTriangle className="mt-0.5 shrink-0" size={18} />
        <p>
          <strong>Source freshness:</strong>{" "}
          {data.sources
            .map(
              (source) =>
                `${source.label}: ${source.status}${source.asOf ? ` (${source.asOf})` : ""}`,
            )
            .join(" · ")}
        </p>
      </section>
      <SectionHeading
        title="Delivery performance & quality"
        subtitle="Latest connected Amazon scorecard"
      />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {deliveryMetricsLive.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </section>
      <SectionHeading
        title="Safety, fleet & workforce"
        subtitle="Connected execution capacity and people coverage"
      />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {workforceMetricsLive.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </section>
      <SectionHeading
        title="Financial & cost control"
        subtitle="Confirmed accounting and Amazon reconciliation evidence"
      />
      {financialMasked ? (
        <section className="grid min-h-36 place-items-center rounded-xl border border-dashed border-amber-300 bg-amber-50 p-6 text-center font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <div>
            <EyeOff className="mx-auto mb-2" />
            Financial data masked
          </div>
        </section>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {financialMetricsLive.map((metric) => (
            <MetricCard key={metric.label} metric={metric} />
          ))}
        </section>
      )}
      <section className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
        <strong>{viewLabel}:</strong> Each metric retains its source period;
        missing connected evidence is shown as unavailable instead of
        substituted with demo values.
      </section>
      <SectionHeading
        title="Delivery, quality & workforce trends"
        subtitle={viewLabel}
      />
      <section className="grid gap-4 xl:grid-cols-2">
        <TrendChart
          title="DSP overall standing score"
          labels={labels}
          series={[
            {
              label: "DSP score",
              color: "#16a34a",
              values: history.slice(start).map((row) => row.overallScore),
              format: (v) => v.toFixed(1),
            },
          ]}
        />
        <TrendChart
          title="POD"
          labels={labels}
          series={[
            {
              label: "POD",
              color: "#0ea5e9",
              values: history.slice(start).map((row) => row.pod),
              format: (v) => `${v.toFixed(2)}%`,
            },
          ]}
        />
        <TrendChart
          title="Delivered packages"
          labels={labels}
          series={[
            {
              label: "Packages",
              color: "#8b5cf6",
              values: history.slice(start).map((row) => row.packages),
              format: (v) => v.toLocaleString(),
            },
          ]}
        />
        <TrendChart
          title="Customer feedback defects"
          labels={labels}
          series={[
            {
              label: "CDF defects",
              color: "#f59e0b",
              values: history.slice(start).map((row) => row.cdf),
            },
          ]}
        />
        <TrendChart
          title="Scorecard active drivers"
          labels={labels}
          series={[
            {
              label: "Active drivers",
              color: "#0ea5e9",
              values: history.slice(start).map((row) => row.activeDrivers),
            },
          ]}
        />
      </section>
      <SectionHeading
        title="Fleet capacity"
        subtitle="Latest connected Fleet Portal and PAVE evidence"
      />
      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-100">
          <Truck className="text-blue-600" size={22} />
          <h3 className="mt-3 font-semibold">
            Fleet status · {data.fleet.asOf || "latest sync"}
          </h3>
          <div className="mt-5 space-y-4">
            <Progress
              label="Operational"
              value={operational}
              max={Math.max(fleetTotal, 1)}
              color="bg-emerald-500"
            />
            <Progress
              label="Grounded"
              value={grounded}
              max={Math.max(fleetTotal, 1)}
              color="bg-red-500"
            />
          </div>
        </article>
        <article className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-100">
          <ShieldCheck className="text-violet-600" size={22} />
          <h3 className="mt-3 font-semibold">Fleet ownership mix</h3>
          <div className="mt-5 space-y-4">
            {Object.entries(ownershipCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([label, value], index) => (
                <Progress
                  key={label}
                  label={label}
                  value={value}
                  max={Math.max(fleetTotal, 1)}
                  color={
                    [
                      "bg-blue-500",
                      "bg-violet-500",
                      "bg-amber-500",
                      "bg-slate-500",
                    ][index % 4]
                  }
                />
              ))}
          </div>
        </article>
      </section>
      <SectionHeading
        title="Source data"
        subtitle="Live connector periods, freshness, and screen coverage"
      />
      <section className="overflow-hidden rounded-xl bg-white shadow-card ring-1 ring-gray-100 dark:bg-slate-900 dark:ring-slate-800">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-slate-950/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Latest successful data</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Feeds</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {data.sources.map((source) => (
                <tr key={`${source.id}-${source.label}`}>
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                    {source.label}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                    {source.asOf || "No successful sync recorded"}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                    {source.status.replaceAll("_", " ")}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                    {source.feeds?.join(" · ") || "Operational dashboard"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default DashboardOverviewPage;
