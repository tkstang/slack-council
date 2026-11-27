import { ChartInputSchema, type ChartInput } from '@council/core/chart.js';
import { failure, success, type Result } from '@council/core/result.js';
import { jsonSchema, tool, type Tool } from 'ai';
import { z } from 'zod';

// Advertise the Zod shape and return validation failures as tool results.
const inputSchema = jsonSchema(
  z.toJSONSchema(ChartInputSchema, { target: 'draft-7' }),
);

export function createShowChartTool(
  charts: ChartInput[] | undefined,
): Tool<unknown, Result<string>> {
  return tool({
    description:
      'Attach a native Slack chart to your reply. Use up to two charts per turn. For bar, line and area charts, give each series one value per category, in category order.',
    inputSchema,
    execute(input) {
      if (!charts)
        return failure(
          'E_INVALID_STATE',
          'Charts are unavailable in react turns. Refer to any chart already posted.',
        );
      const parsed = ChartInputSchema.safeParse(input);
      if (!parsed.success) {
        return failure(
          'E_INVALID_INPUT',
          `Invalid chart at ${parsed.error.issues
            .map(
              ({ path, message }) => `${path.join('.') || 'input'}: ${message}`,
            )
            .join('; ')}`,
        );
      }
      if (charts.length >= 2)
        return failure(
          'E_TOOL_FAILED',
          'Only two charts can be attached per turn',
        );
      charts.push(parsed.data);
      return success('Chart attached to this turn');
    },
  });
}
