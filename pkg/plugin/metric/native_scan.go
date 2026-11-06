package metric

import (
	"context"
	"encoding/json"
	"fmt"
	"io"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
)

// All budgets are shared across namespace groups and continuation pages in one
// execution. A server ignoring limit is still bounded by decoded bytes and objects.
type nativeScanBudget struct {
	bytes   int64
	objects int
	pages   int
}

type nativeBudgetReader struct {
	source io.Reader
	budget *nativeScanBudget
}

func (r *nativeBudgetReader) Read(data []byte) (int, error) {
	if r.budget.bytes <= 0 {
		return 0, errNativeBudget
	}
	if int64(len(data)) > r.budget.bytes {
		data = data[:int(r.budget.bytes)]
	}
	n, err := r.source.Read(data)
	r.budget.bytes -= int64(n)
	return n, err
}

func scanNativeNamespace(ctx context.Context, client rest.Interface, namespace string, budget *nativeScanBudget, visit func(*metricsv1beta1.PodMetrics)) error {
	continuation := ""
	seenContinuation := make(map[string]bool)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		if budget.pages <= 0 || budget.objects <= 0 || budget.bytes <= 0 {
			return errNativeBudget
		}
		budget.pages--
		// metrics-server may ignore limit; never assume one page is bounded by it.
		request := client.Get().AbsPath("/apis/metrics.k8s.io/v1beta1/namespaces/"+namespace+"/pods").
			SetHeader("Accept", "application/json").SetHeader("Accept-Encoding", "identity").Param("limit", "1000")
		if continuation != "" {
			request = request.Param("continue", continuation)
		}
		body, err := request.Stream(ctx)
		if err != nil {
			return err
		}
		next, err := decodeNativePage(ctx, &nativeBudgetReader{source: body, budget: budget}, budget, visit)
		body.Close()
		if err != nil {
			return err
		}
		if next == "" {
			return nil
		}
		if len(next) > 4096 || seenContinuation[next] {
			return fmt.Errorf("metrics source returned an invalid continuation")
		}
		seenContinuation[next] = true
		continuation = next
	}
}

// Decode one object at a time; unrequested Pods never accumulate in memory.
// Decoder read-ahead counts against the same decoded byte budget.
func decodeNativePage(ctx context.Context, reader io.Reader, budget *nativeScanBudget, visit func(*metricsv1beta1.PodMetrics)) (string, error) {
	decoder := json.NewDecoder(reader)
	open, err := decoder.Token()
	if err != nil {
		return "", err
	}
	if open != json.Delim('{') {
		return "", fmt.Errorf("metrics source did not return a list object")
	}
	fields := make(map[string]bool)
	var metadata metav1.ListMeta
	var kind, version string
	for decoder.More() {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		token, err := decoder.Token()
		if err != nil {
			return "", err
		}
		field, ok := token.(string)
		if !ok || fields[field] {
			return "", fmt.Errorf("metrics source returned duplicate or invalid list fields")
		}
		fields[field] = true
		switch field {
		case "items":
			open, err := decoder.Token()
			if err != nil {
				return "", err
			}
			if open != json.Delim('[') {
				return "", fmt.Errorf("metrics source items are not an array")
			}
			for decoder.More() {
				if err := ctx.Err(); err != nil {
					return "", err
				}
				if budget.objects <= 0 {
					return "", errNativeBudget
				}
				budget.objects--
				var item metricsv1beta1.PodMetrics
				if err := decoder.Decode(&item); err != nil {
					return "", err
				}
				visit(&item)
			}
			if _, err := decoder.Token(); err != nil {
				return "", err
			}
		case "metadata":
			if err := decoder.Decode(&metadata); err != nil {
				return "", err
			}
		case "kind":
			if err := decoder.Decode(&kind); err != nil {
				return "", err
			}
		case "apiVersion":
			if err := decoder.Decode(&version); err != nil {
				return "", err
			}
		default:
			var ignored json.RawMessage
			if err := decoder.Decode(&ignored); err != nil {
				return "", err
			}
		}
	}
	if _, err := decoder.Token(); err != nil {
		return "", err
	}
	if !fields["items"] || kind != "PodMetricsList" || version != "metrics.k8s.io/v1beta1" {
		return "", fmt.Errorf("metrics source returned an unexpected list envelope")
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err != nil {
			return "", err
		}
		return "", fmt.Errorf("metrics source returned trailing JSON")
	}
	return metadata.Continue, nil
}
