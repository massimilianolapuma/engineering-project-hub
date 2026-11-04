# Prometheus and Grafana examples

Italiano: [docs/it/outputs.md](../../docs/it/outputs.md)

How to use these files is in [docs/outputs.md](../../docs/outputs.md).

| File                                                                                 | What it is                                                         |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| [`scrape-static-host.yml`](scrape-static-host.yml)                                   | Prometheus scrapes `data/metrics/hub.prom` from a static host.     |
| [`scrape-cloudflare-access.yml`](scrape-cloudflare-access.yml)                       | The same, behind Cloudflare Access, with a service token.          |
| [`fetch-hub-metrics.sh`](fetch-hub-metrics.sh)                                       | Copies the file into node_exporter's textfile collector directory. |
| [`../grafana/engineering-project-hub.json`](../grafana/engineering-project-hub.json) | Grafana dashboard; choose the Prometheus data source after import. |

The dashboard uses the classic dashboard JSON model with `schemaVersion` 41 (Grafana 12).
Grafana migrates an older `schemaVersion` on import, so newer versions read it too.
