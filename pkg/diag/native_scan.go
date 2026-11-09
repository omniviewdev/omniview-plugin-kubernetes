package diag

import (
	"slices"

	sdkdiag "github.com/omniviewdev/plugin-sdk/pkg/diagnostics"
)

// Native metric scans list PodMetrics and NodeMetrics from the cluster's metrics
// API. The host times the provider call as a whole; these counters show what a
// scan cost and how it ended: list requests issued, pages that validated,
// objects decoded, response bytes read, one closed outcome per scan and one
// closed reason per abandoned query. They hold the same line as every other
// instrument here: no namespace, Pod, node, token, URL or error text.
var (
	scanCalls, _    = sdkdiag.Default().Counter("omniview.plugin.self.native_scan.api_calls", "{call}")
	scanPages, _    = sdkdiag.Default().Counter("omniview.plugin.self.native_scan.pages", "{page}")
	scanObjects, _  = sdkdiag.Default().Counter("omniview.plugin.self.native_scan.objects", "{object}")
	scanBytes, _    = sdkdiag.Default().Counter("omniview.plugin.self.native_scan.bytes", "bytes")
	scanResults, _  = sdkdiag.Default().Counter("omniview.plugin.self.native_scan.scans", "{scan}")
	scanAbandons, _ = sdkdiag.Default().Counter("omniview.plugin.self.native_scan.cancellations", "{cancellation}")
)

// ScanOperation is the closed set of native scan kinds.
type ScanOperation string

const (
	// ScanNamespace lists one namespace's PodMetrics, following continuation pages.
	ScanNamespace ScanOperation = "namespace"
	// ScanNode lists the cluster's NodeMetrics, following continuation pages.
	ScanNode ScanOperation = "node"
)

// ScanOutcome is how one scan ended. Cancellation and deadline are separate
// from source failures so an abandoned scan never reads as an unhealthy source.
type ScanOutcome string

const (
	// ScanOK means every page of the scan validated.
	ScanOK ScanOutcome = "ok"
	// ScanDenied means the metrics API answered 401 or 403.
	ScanDenied ScanOutcome = "denied"
	// ScanBudget means the page, object or byte budget stopped the scan.
	ScanBudget ScanOutcome = "budget"
	// ScanCanceled means the scan's context was canceled.
	ScanCanceled ScanOutcome = "canceled"
	// ScanTimeout means a deadline expired.
	ScanTimeout ScanOutcome = "timeout"
	// ScanFailed means any other failure, including an invalid page.
	ScanFailed ScanOutcome = "failed"
)

// ScanAbandon is why a native query ended without delivering results.
type ScanAbandon string

const (
	// AbandonCaller means the caller canceled the query.
	AbandonCaller ScanAbandon = "caller"
	// AbandonDeadline means a deadline expired, the caller's or the scan timeout.
	AbandonDeadline ScanAbandon = "deadline"
	// AbandonRetired means the source generation was retired.
	AbandonRetired ScanAbandon = "retired"
)

var (
	scanOperations = []ScanOperation{ScanNamespace, ScanNode}
	scanOutcomeSet = []ScanOutcome{ScanOK, ScanDenied, ScanBudget, ScanCanceled, ScanTimeout, ScanFailed}
	scanAbandonSet = []ScanAbandon{AbandonCaller, AbandonDeadline, AbandonRetired}
)

// DeclareNativeScan creates every scan counter series at zero. A series exists
// only after its first observation, and a capture that sees one appear after
// its first sample is incomplete. Declaring them keeps captures that straddle
// the first scan, denial, budget stop or cancellation comparable. Zero means no
// such event since this process started. It is safe to call repeatedly.
func DeclareNativeScan() {
	for _, op := range scanOperations {
		a := attr(sdkdiag.KeyOperation, string(op))
		scanCalls.Add(0, a)
		scanPages.Add(0, a)
		scanObjects.Add(0, a)
		scanBytes.Add(0, a)
	}
	for _, outcome := range scanOutcomeSet {
		scanResults.Add(0, attr(sdkdiag.KeyOutcome, string(outcome)))
	}
	for _, reason := range scanAbandonSet {
		scanAbandons.Add(0, attr(sdkdiag.KeyReason, string(reason)))
	}
}

// ScanRequest counts one list request a scan issued, whether or not it succeeds.
func ScanRequest(op ScanOperation) {
	if slices.Contains(scanOperations, op) {
		scanCalls.Add(1, attr(sdkdiag.KeyOperation, string(op)))
	}
}

// ScanPage counts one list page that decoded and validated.
func ScanPage(op ScanOperation) {
	if slices.Contains(scanOperations, op) {
		scanPages.Add(1, attr(sdkdiag.KeyOperation, string(op)))
	}
}

// ScanVolume counts the objects a scan decoded and the response bytes it read,
// including work a failed or canceled scan consumed before it stopped.
func ScanVolume(op ScanOperation, objects, bytes int64) {
	if !slices.Contains(scanOperations, op) {
		return
	}
	a := attr(sdkdiag.KeyOperation, string(op))
	if objects > 0 {
		scanObjects.Add(uint64(objects), a)
	}
	if bytes > 0 {
		scanBytes.Add(uint64(bytes), a)
	}
}

// ScanFinished counts one finished scan. An outcome outside the closed set is
// reported as failed, never as free text.
func ScanFinished(result ScanOutcome) {
	if !slices.Contains(scanOutcomeSet, result) {
		result = ScanFailed
	}
	scanResults.Add(1, attr(sdkdiag.KeyOutcome, string(result)))
}

// ScanAbandoned counts one query that ended without delivering results.
func ScanAbandoned(reason ScanAbandon) {
	if slices.Contains(scanAbandonSet, reason) {
		scanAbandons.Add(1, attr(sdkdiag.KeyReason, string(reason)))
	}
}
