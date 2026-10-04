"use client";

import React from "react";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Copy, Check, BarChart3 } from "lucide-react";
import { copyTextToClipboard } from "@/lib/ai/share";
import { useToastStore } from "@/store/useToastStore";

const COLORS = ["#313032", "#CDB9AB", "#8A7D6B", "#E8E0D5", "#6e7781", "#0550ae", "#1a7f37", "#8250df"];

type ChartType = "bar" | "line" | "pie";
interface ChartJson {
  type?: ChartType;
  title?: string;
  data: any[];
  xKey?: string;
  yKey?: string;
  dataKey?: string;
  nameKey?: string;
}

/** P1 流畅度：流中只渲染占位（此前每 token JSON.parse+recharts 全布局）；data 上限 200 防 SVG 爆炸 */
const CHART_DATA_CAP = 200;
export const KiroChartBlock = React.memo(function KiroChartBlock({
  code,
  streaming = false,
}: {
  code: string;
  streaming?: boolean;
}) {
  const [copied, setCopied] = React.useState(false);
  const pushToast = useToastStore((s) => s.pushToast);
  const copyTimerRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);
  let parsed: ChartJson | null = null;
  let error: string | null = null;
  // 流中 fence 未闭合 / JSON 尚不完整时不做 parse+recharts，只给骨架（闭合瞬间一次真渲染）
  const looksStreaming = streaming;
  try {
    if (looksStreaming) throw new Error("__STREAMING_PLACEHOLDER__");
    parsed = JSON.parse(code);
    if (!parsed || !Array.isArray(parsed.data)) throw new Error("data 需为数组");
  } catch (e: any) {
    if (looksStreaming) error = "__STREAMING__";
    else error = e?.message ?? "JSON 解析失败";
  }

  const onCopy = async () => {
    const ok = await copyTextToClipboard(code);
    if (ok) {
      setCopied(true);
      pushToast({ message: "已复制图表 JSON" });
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
    }
  };

  const type: ChartType = (parsed?.type as ChartType) ?? "bar";
  const rawData = parsed?.data ?? [];
  const capped = rawData.length > CHART_DATA_CAP;
  const data = React.useMemo(() => (capped ? rawData.slice(0, CHART_DATA_CAP) : rawData), [rawData, capped]);
  const xKey = parsed?.xKey ?? parsed?.dataKey ?? "name";
  const yKey = parsed?.yKey ?? "value";
  const nameKey = parsed?.nameKey ?? "name";

  return (
    <div className="my-[0.85em] rounded-xl border border-line bg-white overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-alabaster border-b border-line">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-wide text-sandrift uppercase">
          <BarChart3 className="w-3 h-3" /> Chart · {type.toUpperCase()} {parsed?.title ? `· ${parsed.title}` : ""}
        </span>
        <button
          onClick={onCopy}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white border border-line text-[11px] font-medium text-satin-grey hover:text-charcoal"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? "已复制" : "复制 JSON"}
        </button>
      </div>
      <div className="p-3 bg-white">
        {error === "__STREAMING__" ? (
          <div className="ux-skeleton space-y-2" aria-label="图表生成中">
            <div className="h-3 w-2/5 rounded bg-alabaster" />
            <div className="h-32 rounded bg-alabaster/60" />
          </div>
        ) : error ? (
          <div className="rounded-lg bg-danger-bg border border-danger-border p-3 text-[12px] text-danger">
            图表解析失败：{error}
            <pre className="mt-2 p-2 rounded bg-alabaster border border-line overflow-x-auto font-mono text-[11px] text-charcoal whitespace-pre">
              <code>{code}</code>
            </pre>
          </div>
        ) : data.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line bg-alabaster/30 px-4 py-6 text-center text-[12px] text-sandrift">暂无数据</div>
        ) : (
          <div className="w-full h-[260px]">
            {capped && (
              <p className="mb-2 text-[11px] text-sandrift">数据较多，仅展示前 {CHART_DATA_CAP} 项</p>
            )}
            <ResponsiveContainer width="100%" height="100%">
              {type === "bar" ? (
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8E0D5" />
                  <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: "#676266" }} axisLine={{ stroke: "#E8E0D5" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#676266" }} axisLine={{ stroke: "#E8E0D5" }} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E8E0D5" }} />
                  <Bar dataKey={yKey} fill="#313032" radius={[8, 8, 0, 0]} />
                </BarChart>
              ) : type === "line" ? (
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8E0D5" />
                  <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: "#676266" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#676266" }} />
                  <Tooltip />
                  <Line type="monotone" dataKey={yKey} stroke="#313032" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              ) : (
                <PieChart>
                  <Pie data={data} dataKey={yKey} nameKey={nameKey} cx="50%" cy="50%" outerRadius={90} label>
                    {data.map((_: any, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
});
