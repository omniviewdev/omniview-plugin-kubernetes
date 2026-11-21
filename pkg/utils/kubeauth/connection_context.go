package kubeauth

import (
	"github.com/omniview/kubernetes/pkg/connid"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// ConnectionContext returns the kubeconfig context that the public data of a connection names
// (connid.DataKeyContext): the context its clients are built for, and what the builders of this
// package take as kubeContext. A connection that names none cannot be built.
//
// That error is classified and carries a sentence, where the bare connid.ErrNoContext would reach the
// user as "Provider operation failed" with no cause. It still is connid.ErrNoContext for any caller that
// matches it. A connection without a context is what a saved connection of an earlier version becomes
// (it was stored under the context name, with no data), so the sentence says what to do, and it names
// neither a path nor an ID.
func ConnectionContext(data map[string]any) (string, error) {
	name, err := connid.ContextFromData(data)
	if err != nil {
		return "", &resourcev2.ResourceOperationError{
			Err:     err,
			Code:    "INVALID_REQUEST",
			Title:   "Connection has no kubeconfig context",
			Message: "This connection does not name a kubeconfig context, so it cannot connect. Remove it and use the connection of the same name that is read from your kubeconfig.",
		}
	}
	return name, nil
}
