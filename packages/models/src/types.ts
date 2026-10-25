import type { ModelRequest } from '@remy/core';

/** A request plus provider-level extras that raw clients forward verbatim. */
export interface RawRequest extends ModelRequest {
  /** Forwarded as `response_format`. */
  responseFormat?: Record<string, unknown>;
}
