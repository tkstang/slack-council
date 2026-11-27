// Slack chart mapping based on @chat-adapter/slack 4.45.0 (MIT).
// Copyright (c) 2026 Vercel, Inc.

import type { ChartInput } from '@council/core/chart.js';

export function toChartBlock({ title, chart }: ChartInput) {
  const block = { type: 'data_visualization' as const, title };
  if (chart.type === 'pie') return { ...block, chart };

  const { type, categories, series, xLabel, yLabel } = chart;
  return {
    ...block,
    chart: {
      type,
      series: series.map(({ name, values }) => ({
        name,
        // Validation pairs each value with exactly one category.
        data: values.map((value, index) => ({
          label: categories[index]!,
          value,
        })),
      })),
      axis_config: {
        categories,
        ...(xLabel === undefined ? {} : { x_label: xLabel }),
        ...(yLabel === undefined ? {} : { y_label: yLabel }),
      },
    },
  };
}

// The "Chart:" label tells members reading the transcript that a chart was posted.
export function chartFallback({ title, chart }: ChartInput): string {
  if (chart.type === 'pie') {
    return [
      `Chart: ${title}`,
      'Label | Value',
      ...chart.segments.map(({ label, value }) => `${label} | ${value}`),
    ].join('\n');
  }

  const { categories, series, xLabel, yLabel } = chart;
  return [
    `Chart: ${yLabel ? `${title} (${yLabel})` : title}`,
    [xLabel || 'Category', ...series.map(({ name }) => name)].join(' | '),
    ...categories.map((category, index) =>
      [category, ...series.map(({ values }) => values[index])].join(' | '),
    ),
  ].join('\n');
}
