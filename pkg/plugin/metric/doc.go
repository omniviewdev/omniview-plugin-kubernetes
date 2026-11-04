// Package metric supplies Kubernetes native metrics and the SDK finite-resource
// set capability. The host must admit every resource with the resource owner
// before dispatch, then pass that owner's selected connection in QueryContext.
// ResourceConnectionID must match the context connection. Each resource supplies
// a unique token, native name, namespace, and canonical reference or public
// observation. Opaque identifiers are never split to recover identity.
//
// Metrics-server calls list once per kind and namespace, retain only requested
// resources, and preserve absent samples as missing. Pod Prometheus expressions
// select an explicit escaped finite name set within one namespace and preserve
// namespace/name labels. Current and range queries share these expressions.
// Node exporter queries resolve exact native addresses from one core NodeList.
// Finite address selectors support IPv4 and IPv6 without name-based fallbacks.
// Multiple nodes sharing an address or multiple exporter series matching one
// node produce ambiguous results. Node capacities use the same inventory list,
// independently of metrics-server availability. Failed groups never trigger
// per-resource retries. Metrics-server cannot supply historical series.
// Ambiguity uses a typed local execution error mapped to metric status; it is
// not encoded as an unsupported resource-v2 error code.
//
// Each requested resource/metric pair has a status and native provenance.
// Invalid or nonfinite Prometheus samples fail explicitly, never become zero.
// Prometheus CPU usage rate stays in cores and preserves provider sample time.
// Metrics-server CPU usage and node capacity use millicores. Backend
// failures become failed results, Kubernetes authorization failures become
// denied results, and cancellation terminates the whole request. The old empty
// ResourceID batch convention is rejected; callers must use QueryResources.
package metric
