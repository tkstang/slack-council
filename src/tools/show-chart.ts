import { ChartInputSchema, type ChartInput } from '@council/core/chart.js';
import { failure, success, type Result } from '@council/core/result.js';
import { jsonSchema, tool, type Tool } from 'ai';
import { z } from 'zod';

// Advertise the Zod shape and return validation failures as tool results.
const inputSchema = jsonSchema(
  z.toJSONSchema(ChartInputSchema, { target: 'draft-7' }),
);

export function createShowChartTool(
  charts: ChartInput[],
): Tool<unknown, Result<string>> {
  return tool({
    description:
      'Attach a native Slack chart to your reply. Use up to two charts per turn. For bar, line and area charts, give each series one value per category, in category order.',
    inputSchema,
    execute(input) {
      const parsed = ChartInputSchema.safeParse(input);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const path = issue?.path.join('.') || 'input';
        return failure(
          'E_INVALID_INPUT',
          `Invalid chart at ${path}: ${issue?.message ?? 'invalid value'}`,
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
