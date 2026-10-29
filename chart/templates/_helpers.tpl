{{/*
Expand the name of the chart.
*/}}
{{- define "openprime-app-backend.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "openprime-app-backend.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "openprime-app-backend.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "openprime-app-backend.labels" -}}
helm.sh/chart: {{ include "openprime-app-backend.chart" . }}
{{ include "openprime-app-backend.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "openprime-app-backend.selectorLabels" -}}
app.kubernetes.io/name: {{ include "openprime-app-backend.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "openprime-app-backend.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "openprime-app-backend.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Container env vars (plain values + secret refs), shared by the Deployment and the
migration Job so both always run against the same configuration/secret. The
migration Job passes migrateSecret, so a chart-managed secret is read from its
hook-scoped copy (migration-secret.yaml) that exists before the release's own.
*/}}
{{- define "openprime-app-backend.env" -}}
{{- range $key, $value := .Values.app.env }}
- name: {{ $key }}
  value: {{ $value | quote }}
{{- end }}
{{- if .Values.app.existingSecret }}
{{- range .Values.app.existingSecretKeys }}
- name: {{ . }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.app.existingSecret }}
      key: {{ . }}
{{- end }}
{{- else if .Values.app.secrets }}
{{- range $key, $value := .Values.app.secrets }}
- name: {{ $key }}
  valueFrom:
    secretKeyRef:
      name: {{ include "openprime-app-backend.fullname" $ }}-{{ ternary "migrate-secrets" "secrets" (hasKey $ "migrateSecret") }}
      key: {{ $key }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Metrics listener settings, shared by the API and worker Deployments so the port
the app binds always matches the declared container port.
*/}}
{{- define "openprime-app-backend.metricsEnv" -}}
- name: METRICS_ENABLED
  value: {{ .Values.metrics.enabled | quote }}
- name: METRICS_PORT
  value: {{ .Values.metrics.port | quote }}
{{- end }}

{{/*
Container env vars for the dedicated worker Deployment: the shared app env
(plain values + secret refs) plus worker-specific overrides from
.Values.worker.env. Later entries win in Kubernetes, so worker.env can override
app.env values. The worker also inherits the JOB_ and MAX_CONCURRENT_ job-tuning
vars, UPLOADS_DIR, and secrets (CREDENTIALS_ENCRYPTION_KEY, DB_PASSWORD) from
the shared env.
*/}}
{{- define "openprime-app-backend.workerEnv" -}}
{{- include "openprime-app-backend.env" . }}
{{- range $key, $value := .Values.worker.env }}
- name: {{ $key }}
  value: {{ $value | quote }}
{{- end }}
{{- end }}

{{/*
NetworkPolicy ingress rule letting Prometheus scrape the metrics port. Rendered
by the chart rather than listed in networkPolicy.ingress, because a values
override of that list replaces it wholesale and would silently drop the rule.
*/}}
{{- define "openprime-app-backend.metricsScrapeRule" -}}
- from:
    - namespaceSelector:
        {{- toYaml .Values.metrics.scrapeNamespaceSelector | nindent 8 }}
  ports:
    - protocol: TCP
      port: {{ .Values.metrics.port }}
{{- end }}

{{/*
Fail the render when a value the backend cannot run without is missing, instead
of shipping pods that crash on start. A value counts when it is a non-empty
app.env entry, a key of app.existingSecret (listed in app.existingSecretKeys) or,
without an existingSecret, a non-empty app.secrets entry.
*/}}
{{- define "openprime-app-backend.validateRequiredValues" -}}
{{- $provided := list -}}
{{- range $key, $value := .Values.app.env }}{{ if $value }}{{ $provided = append $provided $key }}{{ end }}{{ end -}}
{{- if .Values.app.existingSecret -}}
{{- $provided = concat $provided .Values.app.existingSecretKeys -}}
{{- else -}}
{{- range $key, $value := .Values.app.secrets }}{{ if $value }}{{ $provided = append $provided $key }}{{ end }}{{ end -}}
{{- end -}}
{{- $missing := list -}}
{{- range list "STATECRAFT_SERVICE_URL" "DB_PASSWORD" "CREDENTIALS_ENCRYPTION_KEY" "SERVICE_TOKEN" -}}
{{- if not (has . $provided) }}{{ $missing = append $missing . }}{{ end -}}
{{- end -}}
{{- if $missing -}}
{{- fail (printf "missing required values: %s. Set STATECRAFT_SERVICE_URL in app.env; provide the secrets via app.existingSecret + app.existingSecretKeys, or app.secrets" (join ", " $missing)) -}}
{{- end -}}
{{- end }}
