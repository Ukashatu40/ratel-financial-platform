// src/tracing.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const metricsPort = Number(process.env.OTEL_METRICS_PORT ?? 9464);

/**
 * If OTEL_EXPORTER_OTLP_ENDPOINT isn't set (e.g. local dev without a
 * collector running), traces are dropped rather than sent nowhere silently
 * failing — NodeSDK simply has no traceExporter configured in that case.
 * Metrics ALWAYS start a local Prometheus scrape endpoint regardless,
 * since that requires no external collector at all — just something
 * pointing curl or Prometheus itself at this process.
 */
const sdk = new NodeSDK({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'ratel-financial-platform' }),
  traceExporter: otlpEndpoint
    ? new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` })
    : undefined,
  metricReader: new PrometheusExporter({ port: metricsPort }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disabling fs instrumentation specifically — it's extremely noisy
      // (every file read/write becomes a span) and rarely useful for a
      // financial API's actual bottlenecks, which are DB/HTTP/queue bound.
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();

// eslint-disable-next-line no-console
console.log(
  `[tracing] OpenTelemetry started — traces: ${otlpEndpoint ? `OTLP -> ${otlpEndpoint}` : 'not configured, dropped'}, metrics: http://localhost:${metricsPort}/metrics`,
);

process.on('SIGTERM', () => {
  sdk.shutdown().finally(() => process.exit(0));
});
