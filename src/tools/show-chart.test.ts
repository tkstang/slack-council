import { ConfigSchema } from '@council/config/schema.js';
import type { ChartInput } from '@council/core/chart.js';
import type { TurnInput } from '@council/core/ports.js';
import { success } from '@council/core/result.js';
import { expect, it, vi } from 'vitest';

import { createMemberTools } from './member-tools.js';
import { createShowChartTool } from './show-chart.js';

const pie = {
  title: 'Work split',
  chart: {
    type: 'pie',
    segments: [{ label: 'Support', value: 12 }],
  },
} satisfies ChartInput;
const line = {
  type: 'line',
  categories: ['Jan', 'Feb'],
  series: [{ name: 'Sales', values: [3, 5] }],
} as const;
const options = { toolCallId: 'chart', messages: [], context: {} };

it.each([
  ['title too long', { ...pie, title: 'a'.repeat(51) }, 'title'],
  [
    'non-positive segment',
    { ...pie, chart: { type: 'pie', segments: [{ label: 'Zero', value: 0 }] } },
    'chart.segments.0.value',
  ],
  [
    'incomplete series',
    { title: 'Sales', chart: { ...line, categories: ['Jan', 'Feb', 'Mar'] } },
    'Each series needs one value per category',
  ],
  [
    'duplicate series',
    {
      title: 'Sales',
      chart: { ...line, series: [...line.series, ...line.series] },
    },
    'Series names must be unique',
  ],
  ['extra property', { ...pie, category: 'unused' }, 'category'],
])('returns a tool error for %s', async (_, args, message) => {
  const charts: ChartInput[] = [];
  const chartTool = createShowChartTool(charts);
  expect(await chartTool.execute?.(args, options)).toMatchObject({
    ok: false,
    code: 'E_INVALID_INPUT',
    message: expect.stringContaining(message),
  });
  expect(charts).toEqual([]);
});

it('grants the tool without default approval and collects at most two charts', async () => {
  const charts: ChartInput[] = [];
  const input: TurnInput = {
    councilId: 'council',
    chainId: 'chain',
    turnId: 'turn',
    scope: { channel: 'C1' },
    member: {
      id: 'ada',
      name: 'Ada',
      avatar: { emoji: ':owl:' },
      provider: 'test',
      model: 'test',
      tools: ['show_chart'],
    },
    charts,
    maxSteps: 3,
    signal: new AbortController().signal,
    prompt: { system: '', user: '' },
  };
  const ask = vi.fn(async () => success(undefined));
  const toolsFor = createMemberTools({
    config: ConfigSchema.shape.tools.parse({}),
    slack: { fetchMessages: async () => success([]) },
    members: [input.member],
    mcp: { toolsFor: () => ({}) },
    approvals: { forTurn: () => ask },
  });
  expect(
    toolsFor({ ...input, member: { ...input.member, tools: [] } }),
  ).toBeUndefined();

  const execute = toolsFor(input)?.show_chart?.execute;
  if (!execute) throw new Error('Missing chart tool');
  const sales = { title: 'Sales', chart: line };
  expect(await execute(pie as never, options)).toMatchObject({ ok: true });
  expect(await execute(sales as never, options)).toMatchObject({ ok: true });
  expect(await execute(pie as never, options)).toMatchObject({
    ok: false,
    code: 'E_TOOL_FAILED',
    message: expect.stringContaining('Only two charts'),
  });
  expect(charts).toEqual([pie, sales]);
  expect(ask).not.toHaveBeenCalled();
});
