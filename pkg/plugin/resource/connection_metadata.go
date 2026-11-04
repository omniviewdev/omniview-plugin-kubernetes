package resource

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/client-go/rest"
)

// connectionMetadata observes public server facts and bounded configuration hints.
func connectionMetadata(ctx context.Context, connection types.Connection, client *clients.ClientSet) (update resourcev2.ConnectionMetadataUpdate, err error) {
	update = resourcev2.ConnectionMetadataUpdate{Set: make(map[string]resourcev2.ConnectionMetadataObservation, 3)}
	unavailable := func(key, code, message string) {
		update.Set[key] = resourcev2.ConnectionMetadataObservation{State: "unavailable", Error: &resourcev2.ConnectionMetadataError{Code: code, Message: message}}
	}
	observe := func(key, value string) {
		if value == "" {
			unavailable(key, "NOT_REPORTED", "The server did not report this fact.")
			return
		}
		update.Set[key] = resourcev2.ConnectionMetadataObservation{State: "success", Value: value, ObservedAt: time.Now().UTC()}
	}
	endpoint := ""
	if client != nil && client.RESTConfig != nil {
		endpoint = sanitizedMetadataEndpoint(client.RESTConfig)
	}
	observe("kubernetes.server_url", endpoint)
	version := ""
	defer func() {
		for key, value := range inferConnectionEnvironment(connection, endpoint, version) {
			observe(key, value)
		}
		for _, key := range environmentMetadataKeys {
			if _, exists := update.Set[key]; !exists {
				update.Remove = append(update.Remove, key)
			}
		}
	}()
	if client == nil || client.DiscoveryClient == nil || client.DiscoveryClient.RESTClient() == nil {
		unavailable("kubernetes.server_version", "CLIENT_UNAVAILABLE", "Server version is unavailable.")
		unavailable("kubernetes.server_platform", "CLIENT_UNAVAILABLE", "Server platform is unavailable.")
		return update, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	stream, err := client.DiscoveryClient.RESTClient().Get().AbsPath("/version").Stream(ctx)
	var data []byte
	if err == nil {
		defer stream.Close()
		data, err = io.ReadAll(io.LimitReader(stream, 64*1024+1))
	}
	var info struct {
		GitVersion string `json:"gitVersion"`
		Platform   string `json:"platform"`
	}
	code, message := "", ""
	switch {
	case errors.Is(ctx.Err(), context.Canceled), errors.Is(err, context.Canceled):
		code, message = "CANCELED", "The observation was canceled."
	case errors.Is(ctx.Err(), context.DeadlineExceeded), errors.Is(err, context.DeadlineExceeded), apierrors.IsTimeout(err), apierrors.IsServerTimeout(err):
		code, message = "TIMEOUT", "The observation timed out."
	case apierrors.IsUnauthorized(err):
		code, message = "UNAUTHENTICATED", "Authentication is required to observe the server."
	case apierrors.IsForbidden(err):
		code, message = "FORBIDDEN", "Permission to observe the server was denied."
	case err != nil:
		var timeout net.Error
		if errors.As(err, &timeout) && timeout.Timeout() {
			code, message = "TIMEOUT", "The observation timed out."
		} else {
			code, message = "TRANSPORT_FAILED", "The server could not be reached."
		}
	case len(data) > 64*1024:
		code, message = "RESPONSE_LIMIT", "The server observation exceeded the response limit."
	case json.Unmarshal(data, &info) != nil:
		code, message = "MALFORMED_RESPONSE", "The server returned an invalid observation."
	}
	if code != "" {
		// Keep typed failure categories, never raw transport errors or provider responses.
		unavailable("kubernetes.server_version", code, message)
		unavailable("kubernetes.server_platform", code, message)
		return update, nil
	}
	version = info.GitVersion
	observe("kubernetes.server_version", info.GitVersion)
	observe("kubernetes.server_platform", info.Platform)
	return update, nil
}

func sanitizedMetadataEndpoint(config *rest.Config) string {
	if config == nil || config.Host == "" {
		return ""
	}
	// Match the REST client's host normalization and configuration-based TLS default.
	endpoint, _, err := rest.DefaultServerUrlFor(config)
	if err != nil || endpoint.Host == "" || (endpoint.Scheme != "https" && endpoint.Scheme != "http") {
		return ""
	}
	endpoint.User = nil
	endpoint.RawQuery = ""
	endpoint.ForceQuery = false
	endpoint.Fragment = ""
	endpoint.RawFragment = ""
	return endpoint.String()
}
