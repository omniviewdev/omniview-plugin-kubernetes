package resource

import (
	"sort"
	"strconv"
	"strings"

	"github.com/omniview/kubernetes/pkg/diag"
	"go.uber.org/zap"
)

// providerLog returns the provider logger, falling back to the process logger
// for providers constructed without one.
func providerLog(p *kubernetesProvider) *zap.SugaredLogger {
	if p != nil && p.logger != nil {
		return p.logger.Named("catalog")
	}
	return zap.S().Named("catalog")
}

// logNativeSchemaFailures summarizes per-type schema fetch failures with closed
// reasons only: local budget names or diag error classes, never error text.
func (p *kubernetesProvider) logNativeSchemaFailures(failures map[string]error) {
	if len(failures) == 0 {
		return
	}
	counts := make(map[string]int)
	budgetReasons := make(map[string]struct{})
	cancellationOnly := true
	for _, err := range failures {
		reason := nativeBudgetReason(err)
		if reason != "" {
			budgetReasons[reason] = struct{}{}
		} else {
			reason = diag.ClassifyError(err, false).Class
			if reason == "" {
				reason = "other"
			}
		}
		if reason != "canceled" && reason != "deadline_exceeded" {
			cancellationOnly = false
		}
		counts[reason]++
	}
	reasons := make([]string, 0, len(counts))
	for reason, n := range counts {
		reasons = append(reasons, reason+"="+strconv.Itoa(n))
	}
	sort.Strings(reasons)
	log := providerLog(p)
	if len(budgetReasons) != 0 {
		budget := make([]string, 0, len(budgetReasons))
		for reason := range budgetReasons {
			budget = append(budget, reason)
		}
		sort.Strings(budget)
		log.Warnw("native catalog budget exhausted", "reason", strings.Join(budget, ","), "schema_failures", len(failures))
	}
	if cancellationOnly {
		log.Debugw("native schema fetch interrupted", "schema_failures", len(failures), "reasons", strings.Join(reasons, ","))
		return
	}
	log.Warnw("native schema fetch failed for some types", "schema_failures", len(failures), "reasons", strings.Join(reasons, ","))
}
