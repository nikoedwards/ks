import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pocket AI Recorder Timeline',
  description: 'Pocket (HeyPocket) AI recorder launch and growth timeline.',
};

const WIDTH = 1180;
const HEIGHT = 650;
const MARGIN = { top: 74, right: 54, bottom: 108, left: 70 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = 440;
const Y_MIN = -46;
const Y_MAX = 132;
const DOMAIN_MONTHS = 26; // 2024-05 -> 2026-07

type Point = {
  date: string;
  value: number;
  kind?: 'growth' | 'risk';
};

type Annotation = {
  date: string;
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
  color: 'blue' | 'red';
  lines: string[];
  bend?: number;
};

const timeline: Point[] = [
  { date: '2024-06', value: 1 },
  { date: '2024-10', value: 2, kind: 'growth' },
  { date: '2024-12', value: 5, kind: 'growth' },
  { date: '2025-03', value: 4 },
  { date: '2025-05', value: 6, kind: 'growth' },
  { date: '2025-07', value: 9 },
  { date: '2025-08', value: 12 },
  { date: '2025-09', value: 15 },
  { date: '2025-10', value: 33, kind: 'risk' },
  { date: '2025-11', value: 55, kind: 'growth' },
  { date: '2025-12', value: 60 },
  { date: '2026-02', value: 43, kind: 'growth' },
  { date: '2026-03', value: 100, kind: 'risk' },
  { date: '2026-04', value: 85 },
];

const annotations: Annotation[] = [
  {
    date: '2024-10',
    value: 2,
    x: 190,
    y: 446,
    w: 138,
    h: 48,
    color: 'blue',
    lines: ['2024-10', '公司成立', 'Open Vision Engineering'],
    bend: 402,
  },
  {
    date: '2024-12',
    value: 5,
    x: 270,
    y: 500,
    w: 164,
    h: 48,
    color: 'blue',
    lines: ['2024-12', '$79 预售开局', '曾 MKBHD / Paytm 创始人声量'],
    bend: 474,
  },
  {
    date: '2025-05',
    value: 6,
    x: 545,
    y: 314,
    w: 148,
    h: 48,
    color: 'blue',
    lines: ['2025-05', '品牌切换 → heypocket.com', '工程公司叙事 → 消费品牌'],
    bend: 304,
  },
  {
    date: '2025-10',
    value: 33,
    x: 660,
    y: 484,
    w: 148,
    h: 48,
    color: 'red',
    lines: ['2025-10', '商业化上市（营收从 $0 起）', '+ MKBHD 误用背书'],
    bend: 438,
  },
  {
    date: '2025-11',
    value: 55,
    x: 675,
    y: 35,
    w: 132,
    h: 48,
    color: 'blue',
    lines: ['2025-11', '正式 launch', '进入 50% MoM 快速起量'],
    bend: 145,
  },
  {
    date: '2026-02',
    value: 43,
    x: 920,
    y: 442,
    w: 158,
    h: 48,
    color: 'blue',
    lines: ['2026-02', '$27M ARR / 5个月 30k 台', '50% MoM订阅(54%)反超硬件'],
    bend: 380,
  },
  {
    date: '2026-03',
    value: 100,
    x: 990,
    y: 49,
    w: 172,
    h: 34,
    color: 'red',
    lines: ['2026-03', 'YC W26 官方 launch + 刷屏长文'],
    bend: 92,
  },
];

const xTicks = [
  '2024-05',
  '2024-07',
  '2024-09',
  '2024-11',
  '2025-01',
  '2025-03',
  '2025-05',
  '2025-07',
  '2025-09',
  '2025-11',
  '2026-01',
  '2026-03',
  '2026-05',
  '2026-07',
];

const yTicks = [0, 25, 50, 75, 100];

function monthIndex(date: string) {
  const [year, month] = date.split('-').map(Number);
  return (year - 2024) * 12 + month - 5;
}

function xScale(date: string) {
  return MARGIN.left + (monthIndex(date) / DOMAIN_MONTHS) * PLOT_WIDTH;
}

function yScale(value: number) {
  return MARGIN.top + ((Y_MAX - value) / (Y_MAX - Y_MIN)) * PLOT_HEIGHT;
}

function linePath(points: Point[]) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${xScale(point.date).toFixed(1)} ${yScale(point.value).toFixed(1)}`).join(' ');
}

function areaPath(points: Point[]) {
  const baseline = yScale(0);
  const first = points[0];
  const last = points[points.length - 1];
  return [
    `M ${xScale(first.date).toFixed(1)} ${baseline.toFixed(1)}`,
    linePath(points).replace(/^M /, 'L '),
    `L ${xScale(last.date).toFixed(1)} ${baseline.toFixed(1)}`,
    'Z',
  ].join(' ');
}

function connectorPath(annotation: Annotation) {
  const px = xScale(annotation.date);
  const py = yScale(annotation.value);
  const anchorX = annotation.x + annotation.w / 2;
  const anchorY = annotation.y > py ? annotation.y : annotation.y + annotation.h;
  return `M ${px.toFixed(1)} ${py.toFixed(1)} Q ${anchorX.toFixed(1)} ${(annotation.bend ?? ((py + anchorY) / 2)).toFixed(1)} ${anchorX.toFixed(1)} ${anchorY.toFixed(1)}`;
}

function AnnotationBox({ annotation }: { annotation: Annotation }) {
  const stroke = annotation.color === 'red' ? '#ff3b30' : '#2563ff';
  return (
    <g>
      <path d={connectorPath(annotation)} fill="none" stroke={stroke} strokeWidth="1.7" vectorEffect="non-scaling-stroke" />
      <rect
        x={annotation.x}
        y={annotation.y}
        width={annotation.w}
        height={annotation.h}
        rx="5"
        fill="#fff"
        stroke={stroke}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      <text x={annotation.x + annotation.w / 2} y={annotation.y + 13} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#111827">
        {annotation.lines.map((line, index) => (
          <tspan key={line} x={annotation.x + annotation.w / 2} dy={index === 0 ? 0 : 13}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

export default function PocketTimelinePage() {
  const chartLine = linePath(timeline);
  const chartArea = areaPath(timeline);
  const plotBottom = MARGIN.top + PLOT_HEIGHT;
  const baseline = yScale(0);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f5f6fa] text-gray-950">
      <section className="mx-auto w-full max-w-7xl overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 max-w-[calc(100vw-2rem)] sm:max-w-3xl">
            <p className="text-xs font-bold uppercase text-blue-600">Pocket case map</p>
            <h1 className="mt-1 w-full break-words text-[22px] font-black leading-tight text-gray-950 sm:text-3xl">
              Pocket (HeyPocket) AI 录音器发展关键节点
            </h1>
            <p className="mt-2 w-full text-sm leading-6 text-gray-500">
              以产品发布、增长节点和争议事件为主轴，把 2024.10 到 2026 的起量路径整理成一张可分享页面。
            </p>
          </div>
          <div className="inline-flex w-fit items-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 shadow-sm">
            2024.10 → 2026
          </div>
        </div>

        <div className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="w-full min-w-0 max-w-full overflow-x-auto">
            <svg
              role="img"
              aria-label="Pocket HeyPocket AI 录音器发展关键节点时间线图"
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="h-auto min-w-[1080px] w-full bg-white"
            >
              <title>Pocket (HeyPocket) AI 录音器发展关键节点时间线</title>
              <rect width={WIDTH} height={HEIGHT} fill="#ffffff" />

              <text x={WIDTH / 2} y="24" textAnchor="middle" fontSize="20" fontWeight="800" fill="#111827">
                Pocket (HeyPocket) AI 录音器 · 发展关键节点（2024.10 → 2026）
              </text>

              <g transform="translate(86 42)" fontSize="10.5" fill="#111827">
                <circle cx="0" cy="0" r="5" fill="#2563eb" />
                <text x="15" y="4">产品 / 增长节点</text>
                <circle cx="0" cy="19" r="5" fill="#ff3b30" />
                <text x="15" y="23">风险 / 争议事件</text>
                <line x1="-5" y1="38" x2="8" y2="38" stroke="#82a8ff" strokeWidth="3" />
                <text x="15" y="42">搜索热度 / 增长曲线（示意）</text>
              </g>

              <g opacity="0.07" fill="#64748b" fontSize="23" fontWeight="700">
                {[
                  [138, 275],
                  [360, 392],
                  [620, 278],
                  [1030, 278],
                  [175, 430],
                ].map(([x, y]) => (
                  <text key={`${x}-${y}`} x={x} y={y} transform={`rotate(-15 ${x} ${y})`}>
                    Edward Hou 5344
                  </text>
                ))}
              </g>

              <line x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left} y2={plotBottom} stroke="#111827" strokeWidth="1.4" />
              <line x1={MARGIN.left} y1={plotBottom} x2={WIDTH - MARGIN.right} y2={plotBottom} stroke="#111827" strokeWidth="1.4" />

              <g>
                {yTicks.map(tick => {
                  const y = yScale(tick);
                  return (
                    <g key={tick}>
                      <line
                        x1={MARGIN.left}
                        y1={y}
                        x2={WIDTH - MARGIN.right}
                        y2={y}
                        stroke={tick === 0 ? '#cbd5e1' : '#e5e7eb'}
                        strokeDasharray={tick === 0 ? '0' : '3 3'}
                      />
                      <text x={MARGIN.left - 14} y={y + 4} textAnchor="end" fontSize="11" fill="#111827">
                        {tick}
                      </text>
                    </g>
                  );
                })}
              </g>

              <text
                x="22"
                y={MARGIN.top + PLOT_HEIGHT / 2}
                textAnchor="middle"
                transform={`rotate(-90 22 ${MARGIN.top + PLOT_HEIGHT / 2})`}
                fontSize="13"
                fontWeight="700"
                fill="#111827"
              >
                相对热度 / 增长（示意）
              </text>

              <g>
                {xTicks.map(tick => {
                  const x = xScale(tick);
                  return (
                    <g key={tick}>
                      <line x1={x} y1={plotBottom} x2={x} y2={plotBottom + 5} stroke="#94a3b8" />
                      <text x={x - 2} y={plotBottom + 34} textAnchor="end" transform={`rotate(-35 ${x - 2} ${plotBottom + 34})`} fontSize="10.5" fill="#111827">
                        {tick}
                      </text>
                    </g>
                  );
                })}
              </g>

              <path d={chartArea} fill="#eaf1ff" />
              <path d={chartLine} fill="none" stroke="#82a8ff" strokeWidth="3" vectorEffect="non-scaling-stroke" />

              {annotations.map(annotation => (
                <AnnotationBox key={`${annotation.date}-${annotation.color}`} annotation={annotation} />
              ))}

              <g>
                {timeline
                  .filter(point => point.kind)
                  .map(point => (
                    <circle
                      key={point.date}
                      cx={xScale(point.date)}
                      cy={yScale(point.value)}
                      r="5.2"
                      fill={point.kind === 'risk' ? '#ff3b30' : '#2563eb'}
                      stroke="#fff"
                      strokeWidth="1.5"
                    />
                  ))}
              </g>

              <line x1={MARGIN.left} y1={baseline} x2={WIDTH - MARGIN.right} y2={baseline} stroke="#dbe3f0" />

              <text x={WIDTH / 2} y={HEIGHT - 22} textAnchor="middle" fontSize="9.5" fill="#64748b">
                数据来源：知识星球 Pocket 档案（YC / Sacra / 媒体）+ 本次 SimilarWeb 与 Google Trends 访谈；曲线形态为示意，非精确数值。
              </text>
            </svg>
          </div>
        </div>
      </section>
    </main>
  );
}
