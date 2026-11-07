{{- define "govbiz-data.validate" -}}
{{- if not (kindIs "bool" .Values.allowDisposableData) -}}
  {{- fail "allowDisposableData must be a boolean" -}}
{{- end -}}
{{- if not (kindIs "map" .Values.existingClaims) -}}
  {{- fail "existingClaims must be a map of restored PVC names" -}}
{{- end -}}
{{- if .Values.allowDisposableData -}}
  {{- if .Values.existingClaims -}}
    {{- fail "Disposable data and existingClaims cannot be combined" -}}
  {{- end -}}
{{- else -}}
  {{- $names := keys .Values.stores -}}
  {{- range $name, $_ := .Values.databases -}}
    {{- $names = append $names (printf "%s-mysql" $name) -}}
  {{- end -}}
  {{- if .Values.rabbitmq.enabled -}}{{- $names = append $names "rabbitmq" -}}{{- end -}}
  {{- if ne (len .Values.existingClaims) (len $names) -}}
    {{- fail "Provide one existingClaims entry per enabled store, or explicitly allow disposable data" -}}
  {{- end -}}
  {{- $seen := dict -}}
  {{- range $name := $names -}}
    {{- $claim := index $.Values.existingClaims $name -}}
    {{- if not (kindIs "string" $claim) -}}
      {{- fail (printf "existingClaims.%s must name a restored PVC" $name) -}}
    {{- end -}}
    {{- if or (gt (len $claim) 253) (not (regexMatch `^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$` $claim)) -}}
      {{- fail (printf "existingClaims.%s must be a valid PVC name" $name) -}}
    {{- end -}}
    {{- if hasKey $seen $claim -}}{{- fail "Different stores cannot share a PVC" -}}{{- end -}}
    {{- $_ := set $seen $claim true -}}
  {{- end -}}
  {{- $images := list .Values.mysqlImage -}}
  {{- range $_, $store := .Values.stores -}}
    {{- $images = append $images $store.image -}}
    {{- if eq (default "IfNotPresent" $store.pullPolicy) "Never" -}}
      {{- fail "Retained storage must not depend on locally loaded images" -}}
    {{- end -}}
  {{- end -}}
  {{- if .Values.rabbitmq.enabled -}}{{- $images = append $images .Values.rabbitmq.image -}}{{- end -}}
  {{- range $image := $images -}}
    {{- if not (regexMatch `^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$` $image) -}}
      {{- fail "Retained storage requires image@sha256 references matching the restored data" -}}
    {{- end -}}
  {{- end -}}
{{- end -}}
{{- end -}}
