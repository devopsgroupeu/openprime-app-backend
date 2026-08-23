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
migration Job so both always run against the same configuration/secret.
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
      name: {{ include "openprime-app-backend.fullname" $ }}-secrets
      key: {{ $key }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Container env vars for the dedicated worker Deployment: the shared app env
(plain values + secret refs) plus worker-specific overrides from
.Values.worker.env. Later entries win in Kubernetes, so worker.env can override
app.env values (e.g. WORKER_ENABLED=true, which app.env sets to "false" for the
API pods). The worker also inherits the JOB_ and MAX_CONCURRENT_ job-tuning
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
