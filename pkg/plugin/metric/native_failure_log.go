package metric

import (
	"errors"
	"strconv"
	"time"

	"github.com/omniview/kubernetes/pkg/diag"
	logging "github.com/omniviewdev/plugin-sdk/log"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

const (
	// A metrics API that is not served is a standing condition of the cluster,
	// not an event. It is reported once per connection and afterwards only as an
	// occasional reminder.
	nativeStateLogInterval = 10 * time.Minute
	// Any other failure is reported while it keeps happening, but at most this
	// often for one namespace and failure class.
	nativeFailureLogInterval = time.Minute
	// nativeMaxLogged bounds the reports remembered per connection.
	nativeMaxLogged = 256
)

// nativeLogKey names one rate-limited report. The namespace is empty for a
// standing condition, which belongs to the whole connection.
type nativeLogKey struct {
	class     string
	namespace string
}

// nativeAPIUnavailable reports whether err says the metrics API is not served
// for the cluster: no such API group or resource (404), or an aggregated API
// that has no backend to answer (503). Unlike a refusal or an ordinary server
// error, that stays true from one poll to the next and is the same for every
// namespace.
func nativeAPIUnavailable(err error) bool {
	return apierrors.IsNotFound(err) || apierrors.IsServiceUnavailable(err)
}

// nativeFailureClass names the kind of a scan failure for rate limiting. It
// follows the classification logged with the failure, so one class is one
// pattern of log lines.
func nativeFailureClass(err error) string {
	if errors.Is(err, errNativeBudget) {
		return "budget"
	}
	class := diag.ClassifyError(err, false)
	if class.Class != "kubernetes" {
		return class.Class
	}
	return class.Class + "/" + strconv.Itoa(class.StatusCode) + "/" + class.Reason
}

// scanFailureLevel decides whether a failed namespace scan is logged, and at
// which level. live is false when the failure was replayed from the failure
// cache: the scan was not repeated, so a cache hit never warns and is only
// reported when it is part of a standing condition.
//
// A standing condition warns the first time it is seen on a connection and is
// repeated at debug level at most once per nativeStateLogInterval. Any other
// live failure warns, at most once per nativeFailureLogInterval for each
// namespace and failure class.
func (p *nativeProvider) scanFailureLevel(lane *nativeLane, namespace string, err error, live bool) (logging.Level, bool) {
	standing := nativeAPIUnavailable(err)
	if !live && !standing {
		return 0, false
	}
	key, interval := nativeLogKey{class: nativeFailureClass(err), namespace: namespace}, nativeFailureLogInterval
	if standing {
		key.namespace, interval = "", nativeStateLogInterval
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	now := p.now()
	last, repeated := lane.logged[key]
	if repeated && now.Sub(last) < interval {
		return 0, false
	}
	lane.rememberLogged(key, now)
	if live && !(standing && repeated) {
		return logging.LevelWarn, true
	}
	return logging.LevelDebug, true
}

// rememberLogged records a report. Standing conditions are kept for the life of
// the lane so that their repeats are recognized. The rest are bounded: when the
// history is full, expired reports go first and then the oldest.
// The caller holds nativeProvider.mu.
func (lane *nativeLane) rememberLogged(key nativeLogKey, now time.Time) {
	if lane.logged == nil {
		lane.logged = make(map[nativeLogKey]time.Time)
	}
	if _, known := lane.logged[key]; !known && len(lane.logged) >= nativeMaxLogged {
		var oldest nativeLogKey
		var oldestAt time.Time
		found := false
		for existing, at := range lane.logged {
			switch {
			case existing.namespace == "":
			case now.Sub(at) >= nativeFailureLogInterval:
				delete(lane.logged, existing)
			case !found || at.Before(oldestAt):
				oldest, oldestAt, found = existing, at, true
			}
		}
		if found && len(lane.logged) >= nativeMaxLogged {
			delete(lane.logged, oldest)
		}
	}
	lane.logged[key] = now
}
