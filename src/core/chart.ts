import { z } from 'zod';

const label = z.string().min(1).max(20);
const title = z.string().min(1).max(50);

const pie = z.strictObject({
  type: z.literal('pie'),
  segments: z
    .array(z.strictObject({ label, value: z.number().positive() }))
    .min(1)
    .max(12),
});

const seriesChart = z
  .strictObject({
    type: z.enum(['bar', 'line', 'area']),
    categories: z.array(label).min(1).max(20),
    series: z
      .array(
        z.strictObject({
          name: label,
          values: z.array(z.number()).min(1).max(20),
        }),
      )
      .min(1)
      .max(12),
    xLabel: z.string().min(1).max(50).optional(),
    yLabel: z.string().min(1).max(50).optional(),
  })
  .refine(({ categories }) => new Set(categories).size === categories.length, {
    path: ['categories'],
    message: 'Category labels must be unique',
  })
  .refine(
    ({ series }) =>
      new Set(series.map(({ name }) => name)).size === series.length,
    { path: ['series'], message: 'Series names must be unique' },
  )
  .refine(
    ({ categories, series }) =>
      series.every(({ values }) => values.length === categories.length),
    { path: ['series'], message: 'Each series needs one value per category' },
  );

export const ChartInputSchema = z.strictObject({
  title,
  chart: z.discriminatedUnion('type', [pie, seriesChart]),
});

export type ChartInput = z.infer<typeof ChartInputSchema>;
