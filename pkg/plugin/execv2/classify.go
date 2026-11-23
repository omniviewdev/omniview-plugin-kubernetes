package execv2

import (
	"errors"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/streaming/pkg/httpstream"

	"github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// classify maps an error of the Kubernetes API to a class and reason: by type first, and by text for what arrives as a bare
// string: the container runtime's errors after the upgrade, and the API's own refusals of the upgrade itself (client-go's SPDY
// path flattens a 403 or a 401 into "unable to upgrade connection: <message>"). It returns false for an error that is not the API's.
func classify(err error) (*exec.Error, bool) {
	var upgrade *httpstream.UpgradeFailureError
	switch {
	case apierrors.IsForbidden(err):
		return exec.NewError(exec.ErrorClassForbidden, exec.ErrorReasonTargetDenied, err), true
	case apierrors.IsUnauthorized(err):
		return exec.NewError(exec.ErrorClassUnauthorized, exec.ErrorReasonUnspecified, err), true
	case apierrors.IsNotFound(err):
		return exec.NewError(exec.ErrorClassNotFound, exec.ErrorReasonTargetGone, err), true
	case apierrors.IsTimeout(err), apierrors.IsServerTimeout(err), errors.As(err, &upgrade):
		return exec.NewError(exec.ErrorClassUnavailable, exec.ErrorReasonUnspecified, err), true
	}
	text := strings.ToLower(err.Error())
	switch {
	case strings.Contains(text, " is forbidden"): // the upgrade flattens the API's Status into text: "pods \"x\" is forbidden: User ..."
		return exec.NewError(exec.ErrorClassForbidden, exec.ErrorReasonTargetDenied, err), true
	case strings.HasSuffix(text, "unauthorized"):
		return exec.NewError(exec.ErrorClassUnauthorized, exec.ErrorReasonUnspecified, err), true
	case strings.Contains(text, "executable file not found"), strings.Contains(text, "no such file or directory"):
		return exec.NewError(exec.ErrorClassNotFound, exec.ErrorReasonNoSuchExecutable, err), true
	case strings.Contains(text, "container not found"), strings.Contains(text, "is not running"), strings.Contains(text, "pod does not exist"),
		strings.Contains(text, "cannot exec in a stopped"), strings.Contains(text, "container name must be specified"):
		return exec.NewError(exec.ErrorClassUnavailable, exec.ErrorReasonNotRunning, err), true
	}
	return nil, false
}

// withFacts adds what a host words a refusal from: the program that was not found, the container that was asked for.
func withFacts(req exec.Request, e *exec.Error) *exec.Error {
	switch e.Reason {
	case exec.ErrorReasonNoSuchExecutable:
		e.Facts.Program = req.Argv[0]
	case exec.ErrorReasonNotRunning, exec.ErrorReasonTargetGone:
		e.Facts.SelectionName, e.Facts.SelectionValue = "container", req.Selection["container"]
	}
	return e
}
