import { getCurrentHub, getSpanScope } from '@sentry/opentelemetry';

import * as Sentry from '../../src/';
import type { NodeExperimentalClient } from '../../src/types';
import { cleanupOtel, mockSdkInit } from '../helpers/mockSdkInit';

describe('Integration | Scope', () => {
  afterEach(() => {
    cleanupOtel();
  });

  describe.each([
    ['with tracing', true],
    ['without tracing', false],
  ])('%s', (_name, enableTracing) => {
    it('correctly syncs OTEL context & Sentry hub/scope', async () => {
      const beforeSend = jest.fn(() => null);
      const beforeSendTransaction = jest.fn(() => null);

      mockSdkInit({ enableTracing, beforeSend, beforeSendTransaction });

      const hub = getCurrentHub();
      const client = hub.getClient() as NodeExperimentalClient;

      const rootScope = hub.getScope();

      const error = new Error('test error');
      let spanId: string | undefined;
      let traceId: string | undefined;

      rootScope.setTag('tag1', 'val1');

      Sentry.withScope(scope1 => {
        scope1.setTag('tag2', 'val2');

        Sentry.withScope(scope2b => {
          scope2b.setTag('tag3-b', 'val3-b');
        });

        Sentry.withScope(scope2 => {
          scope2.setTag('tag3', 'val3');

          Sentry.startSpan({ name: 'outer' }, span => {
            expect(getSpanScope(span)).toBe(enableTracing ? scope2 : undefined);

            spanId = span.spanContext().spanId;
            traceId = span.spanContext().traceId;

            Sentry.setTag('tag4', 'val4');

            Sentry.captureException(error);
          });
        });
      });

      await client.flush();

      expect(beforeSend).toHaveBeenCalledTimes(1);
      expect(beforeSend).toHaveBeenCalledWith(
        expect.objectContaining({
          contexts: expect.objectContaining({
            trace: spanId
              ? {
                  span_id: spanId,
                  trace_id: traceId,
                  parent_span_id: undefined,
                }
              : expect.any(Object),
          }),
          tags: {
            tag1: 'val1',
            tag2: 'val2',
            tag3: 'val3',
            tag4: 'val4',
          },
        }),
        {
          event_id: expect.any(String),
          originalException: error,
          syntheticException: expect.any(Error),
        },
      );

      if (enableTracing) {
        expect(beforeSendTransaction).toHaveBeenCalledTimes(1);
        // Note: Scope for transaction is taken at `start` time, not `finish` time
        expect(beforeSendTransaction).toHaveBeenCalledWith(
          expect.objectContaining({
            contexts: expect.objectContaining({
              trace: {
                data: { 'otel.kind': 'INTERNAL' },
                span_id: spanId,
                status: 'ok',
                trace_id: traceId,
              },
            }),
            spans: [],
            start_timestamp: expect.any(Number),
            tags: {
              tag1: 'val1',
              tag2: 'val2',
              tag3: 'val3',
            },
            timestamp: expect.any(Number),
            transaction: 'outer',
            transaction_info: { source: 'custom' },
            type: 'transaction',
          }),
          {
            event_id: expect.any(String),
          },
        );
      }
    });

    it('isolates parallel root scopes', async () => {
      const beforeSend = jest.fn(() => null);
      const beforeSendTransaction = jest.fn(() => null);

      mockSdkInit({ enableTracing, beforeSend, beforeSendTransaction });

      const hub = getCurrentHub();
      const client = hub.getClient() as NodeExperimentalClient;

      const rootScope = hub.getScope();

      const error1 = new Error('test error 1');
      const error2 = new Error('test error 2');
      let spanId1: string | undefined;
      let spanId2: string | undefined;
      let traceId1: string | undefined;
      let traceId2: string | undefined;

      rootScope.setTag('tag1', 'val1');

      Sentry.withScope(scope1 => {
        scope1.setTag('tag2', 'val2a');

        Sentry.withScope(scope2 => {
          scope2.setTag('tag3', 'val3a');

          Sentry.startSpan({ name: 'outer' }, span => {
            spanId1 = span.spanContext().spanId;
            traceId1 = span.spanContext().traceId;

            Sentry.setTag('tag4', 'val4a');

            Sentry.captureException(error1);
          });
        });
      });

      Sentry.withScope(scope1 => {
        scope1.setTag('tag2', 'val2b');

        Sentry.withScope(scope2 => {
          scope2.setTag('tag3', 'val3b');

          Sentry.startSpan({ name: 'outer' }, span => {
            spanId2 = span.spanContext().spanId;
            traceId2 = span.spanContext().traceId;

            Sentry.setTag('tag4', 'val4b');

            Sentry.captureException(error2);
          });
        });
      });

      await client.flush();

      expect(beforeSend).toHaveBeenCalledTimes(2);
      expect(beforeSend).toHaveBeenCalledWith(
        expect.objectContaining({
          contexts: expect.objectContaining({
            trace: spanId1
              ? {
                  span_id: spanId1,
                  trace_id: traceId1,
                  parent_span_id: undefined,
                }
              : expect.any(Object),
          }),
          tags: {
            tag1: 'val1',
            tag2: 'val2a',
            tag3: 'val3a',
            tag4: 'val4a',
          },
        }),
        {
          event_id: expect.any(String),
          originalException: error1,
          syntheticException: expect.any(Error),
        },
      );

      expect(beforeSend).toHaveBeenCalledWith(
        expect.objectContaining({
          contexts: expect.objectContaining({
            trace: spanId2
              ? {
                  span_id: spanId2,
                  trace_id: traceId2,
                  parent_span_id: undefined,
                }
              : expect.any(Object),
          }),
          tags: {
            tag1: 'val1',
            tag2: 'val2b',
            tag3: 'val3b',
            tag4: 'val4b',
          },
        }),
        {
          event_id: expect.any(String),
          originalException: error2,
          syntheticException: expect.any(Error),
        },
      );

      if (enableTracing) {
        expect(beforeSendTransaction).toHaveBeenCalledTimes(2);
      }
    });
  });
});