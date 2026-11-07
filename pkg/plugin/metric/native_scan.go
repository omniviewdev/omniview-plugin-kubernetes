package metric

import (
	"context"
	"encoding/json"
	"fmt"
	"io"

	corev1 "k8s.io/api/core/v1"
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
	if len(data) == 0 {
		return 0, nil
	}
	if r.budget.bytes <= 0 {
		var probe [1]byte
		n, err := r.source.Read(probe[:])
		if n == 0 && err == io.EOF {
			return 0, io.EOF
		}
		return 0, errNativeBudget
	}
	if int64(len(data)) > r.budget.bytes {
		data = data[:int(r.budget.bytes)]
	}
	n, err := r.source.Read(data)
	r.budget.bytes -= int64(n)
	return n, err
}

func scanNativeNamespace(ctx context.Context, client rest.Interface, namespace string, budget *nativeScanBudget, visit func(*metricsv1beta1.PodMetrics), retain ...func(*metricsv1beta1.PodMetrics) bool) error {
	return scanNativeMetrics(ctx, client, "/apis/metrics.k8s.io/v1beta1/namespaces/"+namespace+"/pods", "PodMetricsList", budget, visit, retain...)
}

func scanNativeNodes(ctx context.Context, client rest.Interface, budget *nativeScanBudget, visit func(*metricsv1beta1.NodeMetrics), retain ...func(*metricsv1beta1.NodeMetrics) bool) error {
	return scanNativeMetrics(ctx, client, "/apis/metrics.k8s.io/v1beta1/nodes", "NodeMetricsList", budget, visit, retain...)
}

func scanNativeMetrics[T any](ctx context.Context, client rest.Interface, path, kind string, budget *nativeScanBudget, visit func(*T), retain ...func(*T) bool) error {
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
		request := client.Get().AbsPath(path).
			SetHeader("Accept", "application/json").SetHeader("Accept-Encoding", "identity").Param("limit", "1000")
		if continuation != "" {
			request = request.Param("continue", continuation)
		}
		body, err := request.Stream(ctx)
		if err != nil {
			return err
		}
		next, err := decodeNativeMetricsPage(ctx, &nativeBudgetReader{source: body, budget: budget}, kind, budget, visit, retain...)
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

// Decode one object at a time and retain only admitted targets until the page
// envelope validates. Decoder read-ahead counts against the same byte budget.
func decodeNativePage(ctx context.Context, reader io.Reader, budget *nativeScanBudget, visit func(*metricsv1beta1.PodMetrics)) (string, error) {
	return decodeNativeMetricsPage(ctx, reader, "PodMetricsList", budget, visit)
}

func decodeNativeMetricsPage[T any](ctx context.Context, reader io.Reader, expectedKind string, budget *nativeScanBudget, visit func(*T), retain ...func(*T) bool) (string, error) {
	var pending []*T
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
				var item T
				if err := decoder.Decode(&item); err != nil {
					return "", err
				}
				if err := validateNativeUsage(&item); err != nil {
					return "", err
				}
				if len(retain) == 0 || retain[0](&item) {
					pending = append(pending, &item)
				}
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
	if !fields["items"] || kind != expectedKind || version != "metrics.k8s.io/v1beta1" {
		return "", fmt.Errorf("metrics source returned an unexpected list envelope")
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err != nil {
			return "", err
		}
		return "", fmt.Errorf("metrics source returned trailing JSON")
	}
	if len(metadata.Continue) > 4096 {
		return "", fmt.Errorf("metrics source returned an invalid continuation")
	}
	for _, item := range pending {
		visit(item)
	}
	return metadata.Continue, nil
}

// Each item decodes into fresh ResourceList values. Quantity.UnmarshalJSON
// leaves Format empty for null; every successful ParseQuantity sets a format,
// including DecimalSI for zero. Check that distinction before exposing samples.
func validateNativeUsage(item any) error {
	switch item := item.(type) {
	case *metricsv1beta1.PodMetrics:
		for _, container := range item.Containers {
			if err := validateNativeQuantities(container.Usage); err != nil {
				return err
			}
		}
	case *metricsv1beta1.NodeMetrics:
		return validateNativeQuantities(item.Usage)
	}
	return nil
}

func validateNativeQuantities(usage corev1.ResourceList) error {
	for _, quantity := range usage {
		if quantity.Format == "" {
			return fmt.Errorf("metrics source returned a null measurement")
		}
	}
	return nil
}
