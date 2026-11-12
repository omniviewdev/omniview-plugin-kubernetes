package kubeauth

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials/stscreds"
	"github.com/aws/aws-sdk-go-v2/service/sts"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"go.opentelemetry.io/otel/attribute"

	"github.com/omniview/kubernetes/pkg/diag"
)

// authLogger returns the SDK logger for authentication diagnostics.
func authLogger() logging.Logger { return logging.Default().Named("kubeauth") }

type eksAuthTransport struct {
	ClusterName string
	RoleARN     string
	Profile     string
	Region      string
	// Connection is the connection ID the transport authenticates for; diagnostics only.
	Connection string

	mu        sync.Mutex
	token     string
	expiresAt time.Time

	Base http.RoundTripper
}

// WrappedRoundTripper exposes the owned transport for connection retirement.
func (e *eksAuthTransport) WrappedRoundTripper() http.RoundTripper {
	return e.base()
}

// builds the sts client for making the call to AWS to get the token
func (e *eksAuthTransport) getStsClient(ctx context.Context) (*sts.Client, error) {
	if e.ClusterName == "" {
		return nil, fmt.Errorf("cluster name is required")
	}

	opts := []func(*config.LoadOptions) error{}
	if e.Profile != "" {
		opts = append(
			opts,
			config.WithSharedConfigProfile(e.Profile),
		)
	}
	if e.Region != "" {
		opts = append(opts, config.WithRegion(e.Region))
	}

	// Lazy init STS client
	cfg, err := config.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		// the error is classified and logged by the token refresh caller.
		return nil, fmt.Errorf("error loading aws config: %w", err)
	}

	client := sts.NewFromConfig(cfg)
	if e.RoleARN != "" {
		creds := stscreds.NewAssumeRoleProvider(client, e.RoleARN)
		cfg.Credentials = aws.NewCredentialsCache(creds)
		client = sts.NewFromConfig(cfg)
	}

	return client, err
}

// refreshTokenLocked generates a fresh EKS token. e.mu must be held.
func (e *eksAuthTransport) refreshTokenLocked(ctx context.Context) error {
	ctx, span := diag.Tracer().Start(ctx, "kubernetes.auth.eks.token")
	span.SetAttributes(attribute.String("connection", e.Connection), attribute.Bool("cached", false))
	started := time.Now()

	err := func() error {
		client, err := e.getStsClient(ctx)
		if err != nil {
			span.AddEvent("sts_client_failed")
			return err
		}
		token, err := getEKSToken(ctx, client, e.ClusterName)
		if err != nil {
			span.AddEvent("token_presign_failed")
			return fmt.Errorf("failed to generate EKS token: %w", err)
		}
		e.token = token
		e.expiresAt = time.Now().Add(time.Minute * 14)
		return nil
	}()

	c := diag.EndSpan(span, err, false)
	diag.TokenRefresh(c.Outcome)
	fields := append([]any{"connection", e.Connection, "duration_ms", time.Since(started).Milliseconds()}, c.LogFields()...)
	if err != nil {
		authLogger().Warnw(ctx, "eks token refresh failed", fields...)
		return err
	}
	authLogger().Debugw(ctx, "eks token refreshed", fields...)
	return nil
}

func (e *eksAuthTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return e.roundTripOver(e.base(), req)
}

// roundTripOver authenticates req with the cached token, refreshing it when expired, and sends it over base.
func (e *eksAuthTransport) roundTripOver(base http.RoundTripper, req *http.Request) (*http.Response, error) {
	ctx := req.Context()

	e.mu.Lock()

	// prevent unnecessary calls to sts to get tokens, tokens are set to a known 15 minutes:
	if time.Now().After(e.expiresAt) {
		if err := e.refreshTokenLocked(ctx); err != nil {
			e.mu.Unlock()
			return nil, err
		}
	}
	token := e.token
	e.mu.Unlock()

	req2 := req.Clone(ctx)
	req2.Header.Set("Authorization", "Bearer "+token)

	resp, err := base.RoundTrip(req2)
	if err != nil {
		// never log the error text (*url.Error carries the request URL) or the response.
		fields := append([]any{"connection", e.Connection}, diag.ClassifyError(err, false).LogFields()...)
		authLogger().Debugw(ctx, "eks authenticated request failed", fields...)
	}

	return resp, err
}

func (e *eksAuthTransport) base() http.RoundTripper {
	if e.Base != nil {
		return e.Base
	}
	return http.DefaultTransport
}

// wrapTransport layers EKS authentication, backed by e's token cache, over rt. It is a
// rest.Config.WrapTransport function: transports that client-go builds from the config
// authenticate and share one cache instead of each minting their own tokens.
func (e *eksAuthTransport) wrapTransport(rt http.RoundTripper) http.RoundTripper {
	return &eksBearerTransport{tokens: e, base: rt}
}

// eksBearerTransport authenticates requests over base with the tokens of a shared eksAuthTransport.
type eksBearerTransport struct {
	tokens *eksAuthTransport
	base   http.RoundTripper
}

func (t *eksBearerTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return t.tokens.roundTripOver(t.base, req)
}

// WrappedRoundTripper exposes the wrapped transport for connection retirement.
func (t *eksBearerTransport) WrappedRoundTripper() http.RoundTripper {
	return t.base
}
