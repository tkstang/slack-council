/**
 * Public library barrel — the single entry point. Consumers import `@app/single`
 * (renamed to `@<project>/single`), never deep internal paths.
 */

export { parseConfig, ConfigSchema, type Config } from '@app/config.js';
export {
  type Result,
  type Success,
  type Failure,
  type ErrorCode,
  ERROR_CODES,
  success,
  failure,
  isSuccess,
} from '@app/result.js';
export { CliError, isCliError } from '@app/errors.js';
