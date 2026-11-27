package resource

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/rest"
)

type neighborTestTransport func(*http.Request) (*http.Response, error)

func (f neighborTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type neighborTestDoc = map[string]any

type neighborTestAPI struct {
	t                       *testing.T
	request                 resourcev2.RelatedReadRequest
	ns, name                string
	root                    any
	ingresses, slices, pods []any
	podGets                 map[string]any
	rules                   []any
	intercept               func(*http.Request) (int, any) // zero status delegates
	calls                   []*http.Request
}

func newNeighborTestAPI(t *testing.T, ns, name, uid string, spec neighborTestDoc) *neighborTestAPI {
	t.Helper()
	route := resourcev2.AccessRoute{Connection: "bound-cluster"}
	request := resourcev2.RelatedReadRequest{Operation: serviceNeighborsOperation, Route: route, Root: resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{
		Provider: "kubernetes", Authority: "svc-identity", Type: neighborServiceType, Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: ns}}, ID: name,
	}, Incarnation: &uid}}
	for _, family := range []string{neighborIngressType, neighborPodType, neighborServiceType, neighborSliceType} {
		authority := family + "-identity"
		if family == neighborServiceType {
			authority = request.Root.Address.Authority
		}
		namespaces := []string{ns}
		request.Sources = append(request.Sources, resourcev2.ReadTarget{Provider: "kubernetes", Authority: authority, Type: family, Route: route,
			Scope: resourcev2.QueryScope{{Dimension: "name", Match: resourcev2.ScopeAny}, {Dimension: "namespace", Match: resourcev2.ScopeOneOf, Values: &namespaces}}, Representation: "test.v1"})
	}
	return &neighborTestAPI{t: t, request: request, ns: ns, name: name, ingresses: []any{}, slices: []any{}, pods: []any{}, podGets: map[string]any{},
		rules: []any{neighborTestDoc{"verbs": []string{"get"}, "apiGroups": []string{"*"}, "resources": []string{"*"}}},
		root:  neighborTestDoc{"apiVersion": "v1", "kind": "Service", "metadata": neighborTestDoc{"name": name, "namespace": ns, "uid": uid, "resourceVersion": "9", "labels": map[string]string{"not-a-selector": "true"}}, "spec": spec}}
}

func neighborTestList(api, kind string, items []any, next string) neighborTestDoc {
	return neighborTestDoc{"apiVersion": api, "kind": kind + "List", "metadata": neighborTestDoc{"continue": next}, "items": items}
}

func (f *neighborTestAPI) answer(r *http.Request) (int, any) {
	f.calls = append(f.calls, r)
	if f.intercept != nil {
		if status, body := f.intercept(r); status != 0 {
			return status, body
		}
	}
	const prefix = "/cluster/proxy"
	core := prefix + "/api/v1/namespaces/" + f.ns + "/"
	switch {
	case r.Method == http.MethodPost && r.URL.Path == prefix+neighborRulesPath:
		var req struct {
			APIVersion, Kind string
			Spec             struct{ Namespace string }
		}
		if r.Header.Get("Content-Type") != "application/json" || json.NewDecoder(r.Body).Decode(&req) != nil || req.Kind != "SelfSubjectRulesReview" || req.APIVersion != "authorization.k8s.io/v1" || req.Spec.Namespace != f.ns {
			f.t.Errorf("invalid namespace review: %#v", req)
		}
		return http.StatusCreated, neighborTestDoc{"apiVersion": "authorization.k8s.io/v1", "kind": "SelfSubjectRulesReview", "status": neighborTestDoc{"incomplete": false, "resourceRules": f.rules}}
	case r.Method != http.MethodGet || !strings.HasPrefix(r.URL.Path, prefix+"/") || r.URL.Query().Has("watch"):
		f.t.Errorf("unexpected operation %s %s", r.Method, r.URL)
	case r.URL.Path == core+"services/"+f.name:
		return http.StatusOK, f.root
	case r.URL.Path == prefix+"/apis/networking.k8s.io/v1/namespaces/"+f.ns+"/ingresses":
		return http.StatusOK, neighborTestList("networking.k8s.io/v1", "Ingress", f.ingresses, "")
	case r.URL.Path == prefix+"/apis/discovery.k8s.io/v1/namespaces/"+f.ns+"/endpointslices":
		return http.StatusOK, neighborTestList("discovery.k8s.io/v1", "EndpointSlice", f.slices, "")
	case r.URL.Path == core+"pods":
		if r.Header.Get("Accept") != "application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1" {
			return http.StatusNotAcceptable, nil
		}
		return http.StatusOK, neighborTestList("meta.k8s.io/v1", "PartialObjectMetadata", f.pods, "")
	case strings.HasPrefix(r.URL.Path, core+"pods/"):
		if r.Header.Get("Accept") != "application/json;as=PartialObjectMetadata;g=meta.k8s.io;v=v1" {
			return http.StatusNotAcceptable, nil
		}
		if p := f.podGets[strings.TrimPrefix(r.URL.Path, core+"pods/")]; p != nil {
			return http.StatusOK, p
		}
		return http.StatusNotFound, nil
	default:
		f.t.Errorf("unexpected API path %s", r.URL)
	}
	return http.StatusBadRequest, nil
}

func (f *neighborTestAPI) client() *clients.ClientSet {
	return &clients.ClientSet{RESTConfig: &rest.Config{Host: "https://unused.test/cluster/proxy"}, StreamingHTTPClient: &http.Client{Transport: neighborTestTransport(func(r *http.Request) (*http.Response, error) {
		status, obj := f.answer(r)
		data, err := json.Marshal(obj)
		if err != nil {
			return nil, err
		}
		return &http.Response{StatusCode: status, ContentLength: int64(len(data)), Body: io.NopCloser(bytes.NewReader(data)), Header: http.Header{}}, nil
	})}}
}

func (f *neighborTestAPI) read() (resourcev2.RelatedReadPage, error) {
	return readServiceNeighbors(f.t.Context(), f.client(), f.request)
}

func testSlice(ns, name, service, addressType string, owners, endpoints []any) neighborTestDoc {
	return neighborTestDoc{"apiVersion": "discovery.k8s.io/v1", "kind": "EndpointSlice", "metadata": neighborTestDoc{
		"name": name, "namespace": ns, "uid": name + "-uid", "labels": map[string]string{"kubernetes.io/service-name": service}, "ownerReferences": owners,
	}, "addressType": addressType, "endpoints": endpoints}
}

func testPod(ns, name, uid string, labels map[string]string) neighborTestDoc {
	return neighborTestDoc{"kind": "PartialObjectMetadata", "apiVersion": "meta.k8s.io/v1", "metadata": neighborTestDoc{"name": name, "namespace": ns, "uid": uid, "labels": labels}}
}

func TestServiceNeighborsAuthenticatedEdgesAndCitations(t *testing.T) {
	selector := map[string]string{"app": "web", "tier": "back"}
	f := newNeighborTestAPI(t, "space", "svc", "svc-uid", neighborTestDoc{"type": "ClusterIP", "selector": selector})
	backend := func(name string) neighborTestDoc { return neighborTestDoc{"service": neighborTestDoc{"name": name}} }
	ingress := func(name string, spec neighborTestDoc) neighborTestDoc {
		return neighborTestDoc{"kind": "Ingress", "apiVersion": "networking.k8s.io/v1", "metadata": neighborTestDoc{"namespace": f.ns, "name": name, "uid": name + "-uid"}, "spec": spec}
	}
	viaPath := neighborTestDoc{"backend": backend(f.name)}
	f.ingresses = []any{
		ingress("default-route", neighborTestDoc{"defaultBackend": backend(f.name)}),
		ingress("path-route", neighborTestDoc{"rules": []any{neighborTestDoc{"http": neighborTestDoc{"paths": []any{viaPath, viaPath}}}}}),
		ingress("different", neighborTestDoc{"defaultBackend": backend("other-service")}),
		ingress("resource-backend", neighborTestDoc{"defaultBackend": neighborTestDoc{"resource": neighborTestDoc{"kind": "Service", "name": f.name}}}),
	}
	ref := func(ns, name, uid string) neighborTestDoc {
		return neighborTestDoc{"addresses": []string{"198.51.100.255"}, "targetRef": neighborTestDoc{"kind": "Pod", "namespace": ns, "name": name, "uid": uid}}
	}
	literal := neighborTestDoc{"addresses": []string{"192.0.2.12", "not-an-ip"}}
	owner := func(uid string) []any {
		return []any{neighborTestDoc{"kind": "Service", "apiVersion": "v1", "name": f.name, "uid": uid}}
	}
	f.slices = []any{
		testSlice(f.ns, "z-managed", f.name, "IPv4", owner("svc-uid"), []any{literal, ref(f.ns, "chosen", "chosen-uid")}),
		testSlice(f.ns, "a-manual", f.name, "IPv4", nil, []any{literal, ref(f.ns, "chosen", "chosen-uid"), ref(f.ns, "chosen", "stale"), ref(f.ns, "extra", "extra-uid"), ref(f.ns, "absent", "old"), ref(f.ns, "missing-uid", ""), ref("elsewhere", "private", "private-uid")}),
		testSlice(f.ns, "old-owner", f.name, "IPv4", owner("replaced"), []any{literal}),
		testSlice(f.ns, "foreign-service", "other", "IPv4", nil, []any{literal}),
	}
	f.pods = []any{testPod(f.ns, "chosen", "chosen-uid", selector), testPod(f.ns, "one-label-only", "one-label-uid", map[string]string{"app": "web"})}
	f.podGets["extra"] = testPod(f.ns, "extra", "extra-uid", nil)

	// Exercise the actual authenticated HTTP transport, including a kubeconfig
	// API-server path prefix. An unscoped/credential-free client cannot answer.
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture-principal" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		status, body := f.answer(r)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		if err := json.NewEncoder(w).Encode(body); err != nil {
			t.Errorf("write test API response: %v", err)
		}
	}))
	t.Cleanup(server.Close)
	config := &rest.Config{Host: server.URL + "/cluster/proxy", BearerToken: "fixture-principal", TLSClientConfig: rest.TLSClientConfig{Insecure: true}}
	client, err := rest.HTTPClientFor(config)
	require.NoError(t, err)
	page, err := readServiceNeighbors(t.Context(), &clients.ClientSet{RESTConfig: config, StreamingHTTPClient: client}, f.request)
	require.NoError(t, err)
	require.Equal(t, "complete", page.Coverage)
	require.ElementsMatch(t, []string{neighborServiceType, neighborIngressType, neighborPodType, neighborSliceType}, page.Sources)
	type expected struct{ direction, relation, kind, name, evidence, proof, neighbor string }
	want := []expected{
		{"inbound", "publishes-for", "EndpointSlice", "a-manual", "slice-service-name", "a-manual", "a-manual"},
		{"inbound", "publishes-for", "EndpointSlice", "z-managed", "slice-service-name", "z-managed", "z-managed"},
		{"inbound", "routes-to", "Ingress", "default-route", "ingress-backend", "default-route", "default-route"},
		{"inbound", "routes-to", "Ingress", "path-route", "ingress-backend", "path-route", "path-route"},
		{"outbound", "has-endpoint", "EndpointAddress", "192.0.2.12", "slice-address", "a-manual", ""},
		{"outbound", "has-endpoint", "Pod", "chosen", "slice-target", "a-manual", "chosen"},
		{"outbound", "has-endpoint", "Pod", "extra", "slice-target", "a-manual", "extra"},
		{"outbound", "selects", "Pod", "chosen", "service-selector", "svc", "chosen"},
	}
	require.Len(t, page.Rows, len(want))
	for i, w := range want {
		r := page.Rows[i]
		require.Equal(t, map[string]any{"direction": w.direction, "relation": w.relation, "kind": w.kind, "namespace": f.ns, "name": w.name, "evidence": w.evidence}, r.Row)
		require.NotEmpty(t, r.Evidence)
		require.Equal(t, w.proof, r.Evidence[0].Address.ID)
		for _, proof := range r.Evidence {
			require.Equal(t, f.request.Root.Address.Scope, proof.Address.Scope)
			require.Equal(t, "kubernetes", proof.Address.Provider)
			require.Equal(t, proof.Address.ID+"-uid", *proof.Incarnation)
			if proof.Address.Type == neighborServiceType {
				require.Equal(t, f.request.Root, proof)
			} else {
				require.Equal(t, proof.Address.Type+"-identity", proof.Address.Authority)
			}
		}
		if w.neighbor == "" {
			require.Nil(t, r.Neighbor)
		} else {
			require.NotNil(t, r.Neighbor)
			require.Equal(t, w.neighbor, r.Neighbor.Address.ID)
			require.Contains(t, r.Evidence, *r.Neighbor)
		}
	}
	require.Len(t, f.calls, 8) // two roots, one scope review, three lists, two unselected Pod lookups
	for _, r := range f.calls {
		q := r.URL.Query()
		switch {
		case strings.HasSuffix(r.URL.Path, "/pods"):
			require.Equal(t, "app=web,tier=back", q.Get("labelSelector"))
			require.Equal(t, metadataListMediaType, r.Header.Get("Accept"))
		case strings.HasSuffix(r.URL.Path, "/endpointslices"):
			require.Equal(t, "kubernetes.io/service-name=svc", q.Get("labelSelector"))
		}
		if q.Has("limit") {
			require.Equal(t, "64", q.Get("limit"))
		}
	}
}

func TestServiceNeighborsCapturedSelectorlessService(t *testing.T) {
	// Replay the checked-in, independently captured API objects, not the table
	// cells/describe text. Neither fixture is a substitute for API admission.
	var services struct {
		Objects []struct{ Object json.RawMessage }
	}
	var slicesFile struct {
		Captures []struct {
			Rows []struct{ Object json.RawMessage }
		}
	}
	load := func(path string, out any) {
		data, err := os.ReadFile("../../../ui/src/kinds/" + path)
		require.NoError(t, err)
		require.NoError(t, json.Unmarshal(data, out))
	}
	load("services/fixtures/services-detail.json", &services)
	load("endpointslices/fixtures/endpointslices-table.json", &slicesFile)
	var root neighborService
	var service json.RawMessage
	for _, row := range services.Objects {
		var obj neighborService
		require.NoError(t, json.Unmarshal(row.Object, &obj))
		if obj.Metadata.Name == "kubernetes" && obj.Metadata.Namespace == "default" {
			service, root = row.Object, obj
			break
		}
	}
	require.NotEmpty(t, service)
	f := newNeighborTestAPI(t, "default", "kubernetes", root.Metadata.UID, nil)
	f.root = service
	for _, capture := range slicesFile.Captures {
		for _, row := range capture.Rows {
			var obj neighborSlice
			require.NoError(t, json.Unmarshal(row.Object, &obj))
			if obj.Metadata.Namespace == f.ns && obj.Metadata.Labels["kubernetes.io/service-name"] == f.name {
				f.slices = append(f.slices, row.Object)
			}
		}
	}
	page, err := f.read()
	require.NoError(t, err)
	require.Equal(t, "complete", page.Coverage)
	require.Len(t, page.Rows, 2)
	require.Equal(t, "slice-service-name", page.Rows[0].Row["evidence"])
	require.Equal(t, "kubernetes", page.Rows[0].Row["name"])
	require.Equal(t, "slice-address", page.Rows[1].Row["evidence"])
	require.Equal(t, "172.18.0.2", page.Rows[1].Row["name"])
	require.Nil(t, page.Rows[1].Neighbor)
	require.Equal(t, page.Rows[0].Neighbor, &page.Rows[1].Evidence[0])
	require.Len(t, f.calls, 5)
}

func TestServiceNeighborsForwardingTypesAndExternalAlias(t *testing.T) {
	for _, serviceType := range []string{"ClusterIP", "NodePort", "LoadBalancer", "ExternalName"} {
		t.Run(serviceType, func(t *testing.T) {
			selector := map[string]string{"app": "backend"}
			spec := neighborTestDoc{"type": serviceType, "selector": selector}
			if serviceType == "ClusterIP" {
				spec["clusterIP"] = "None"
			}
			if serviceType == "ExternalName" {
				spec["externalName"] = "external.example.test"
			}
			f := newNeighborTestAPI(t, "network", "svc", "root", spec)
			f.pods = []any{testPod(f.ns, "backend", "pod-uid", selector)}
			f.slices = []any{testSlice(f.ns, "v6", f.name, "IPv6", nil, []any{neighborTestDoc{"addresses": []string{"2001:db8::1"}}}), testSlice(f.ns, "fqdn", f.name, "FQDN", nil, []any{neighborTestDoc{"addresses": []string{"backend.example.test."}}})}
			p, err := f.read()
			require.NoError(t, err)
			require.Equal(t, "complete", p.Coverage)
			if serviceType == "ExternalName" {
				require.Len(t, p.Rows, 3) // inbound slices and only the literal alias outbound
				require.Equal(t, map[string]any{"direction": "outbound", "relation": "aliases", "kind": "DNSName", "namespace": "network", "name": "external.example.test", "evidence": "external-name"}, p.Rows[2].Row)
				require.Nil(t, p.Rows[2].Neighbor)
				require.Equal(t, []resourcev2.ResourceReference{f.request.Root}, p.Rows[2].Evidence)
				require.Len(t, f.calls, 5)
			} else {
				require.Len(t, p.Rows, 5)
				require.Equal(t, "2001:db8::1", p.Rows[2].Row["name"])
				require.Equal(t, "backend.example.test.", p.Rows[3].Row["name"])
				require.Equal(t, "selects", p.Rows[4].Row["relation"])
			}
		})
	}
}

func TestServiceNeighborsCoverageAndReservedRoot(t *testing.T) {
	t.Run("complete empty, not unavailable", func(t *testing.T) {
		f := newNeighborTestAPI(t, "network", "empty", "r", neighborTestDoc{"selector": map[string]string{}})
		p, err := f.read()
		require.NoError(t, err)
		require.Equal(t, "complete", p.Coverage)
		require.NotNil(t, p.Rows)
		require.Empty(t, p.Rows)
		require.Len(t, f.calls, 5)
	})
	t.Run("denied root", func(t *testing.T) {
		f := newNeighborTestAPI(t, "network", "denied", "r", nil)
		f.intercept = func(*http.Request) (int, any) { return 403, "private denial body" }
		p, err := f.read()
		require.Equal(t, "PERMISSION_DENIED", resourcev2.ErrorCode(err))
		require.NotContains(t, err.Error(), "private")
		require.Nil(t, p.Rows)
		require.Len(t, f.calls, 1)
	})
	t.Run("all sources denied", func(t *testing.T) {
		f := newNeighborTestAPI(t, "network", "svc", "r", nil)
		f.intercept = func(r *http.Request) (int, any) {
			if r.URL.Query().Has("limit") {
				return 403, "secret source inventory"
			}
			return 0, nil
		}
		p, err := f.read()
		require.Equal(t, "PERMISSION_DENIED", resourcev2.ErrorCode(err))
		require.Nil(t, p.Rows)
	})
	t.Run("withheld and denied sources", func(t *testing.T) {
		f := newNeighborTestAPI(t, "network", "svc", "r", neighborTestDoc{"selector": map[string]string{"a": "b"}})
		f.request.Sources = slices.DeleteFunc(f.request.Sources, func(t resourcev2.ReadTarget) bool { return t.Type == neighborPodType })
		f.intercept = func(r *http.Request) (int, any) {
			if strings.HasSuffix(r.URL.Path, "/ingresses") {
				return 403, "unreadable"
			}
			return 0, nil
		}
		f.slices = []any{testSlice(f.ns, "published", f.name, "IPv4", nil, []any{neighborTestDoc{"addresses": []string{"192.0.2.9"}, "targetRef": neighborTestDoc{"kind": "Pod", "name": "withheld", "uid": "private", "namespace": f.ns}}})}
		p, err := f.read()
		require.NoError(t, err)
		require.Equal(t, "partial", p.Coverage)
		require.ElementsMatch(t, []string{neighborServiceType, neighborSliceType}, p.Sources)
		require.Len(t, p.Rows, 1)
		require.Equal(t, "published", p.Rows[0].Row["name"])
		require.Len(t, f.calls, 5)
	})
	t.Run("native Pod denial never falls back to a referenced address", func(t *testing.T) {
		f := newNeighborTestAPI(t, "network", "svc", "r", nil)
		f.rules = []any{neighborTestDoc{"verbs": []string{"get"}, "apiGroups": []string{"*"}, "resources": []string{"ingresses", "endpointslices"}}}
		f.slices = []any{testSlice(f.ns, "published", f.name, "IPv4", nil, []any{neighborTestDoc{"addresses": []string{"192.0.2.9"}, "targetRef": neighborTestDoc{"kind": "Pod", "name": "private-pod", "uid": "private-uid", "namespace": f.ns}}})}
		f.intercept = func(r *http.Request) (int, any) {
			if strings.HasSuffix(r.URL.Path, "/pods/private-pod") {
				t.Error("queried a Pod without independent namespace GET provenance")
				return 403, "private denial"
			}
			return 0, nil
		}
		p, err := f.read()
		require.NoError(t, err)
		require.Equal(t, "partial", p.Coverage)
		require.NotContains(t, p.Sources, neighborPodType)
		require.Len(t, p.Rows, 1)
		require.Equal(t, "published", p.Rows[0].Row["name"])
		data, err := json.Marshal(p)
		require.NoError(t, err)
		require.NotContains(t, string(data), "private")
		require.NotContains(t, string(data), "192.0.2.9")
	})
	t.Run("hidden Pod contents do not affect the page or its acquisition", func(t *testing.T) {
		var baseline resourcev2.RelatedReadPage
		for _, hidden := range []bool{false, true} {
			f := newNeighborTestAPI(t, "network", "svc", "r", neighborTestDoc{"selector": map[string]string{"app": "private"}})
			f.rules = []any{
				neighborTestDoc{"verbs": []string{"get"}, "apiGroups": []string{"networking.k8s.io", "discovery.k8s.io"}, "resources": []string{"ingresses", "endpointslices"}},
				neighborTestDoc{"verbs": []string{"list"}, "apiGroups": []string{""}, "resources": []string{"pods"}},
				neighborTestDoc{"verbs": []string{"get"}, "apiGroups": []string{""}, "resources": []string{"pods"}, "resourceNames": []string{"named-only"}},
				neighborTestDoc{"verbs": []string{"get"}, "apiGroups": []string{"wrong.example"}, "resources": []string{"pods"}},
				neighborTestDoc{"verbs": []string{"get"}, "apiGroups": []string{""}, "resources": []string{"pods/status"}},
			}
			endpoints := []any{}
			if hidden {
				endpoints = append(endpoints, neighborTestDoc{"addresses": []string{"192.0.2.40"}, "targetRef": neighborTestDoc{"kind": "Pod", "namespace": f.ns, "name": "private", "uid": "private"}})
				f.pods = []any{testPod(f.ns, "private", "private", map[string]string{"app": "private"})}
			}
			f.slices = []any{testSlice(f.ns, "published", f.name, "IPv4", nil, endpoints)}
			p, err := f.read()
			require.NoError(t, err)
			require.Equal(t, "partial", p.Coverage)
			require.ElementsMatch(t, []string{neighborServiceType, neighborIngressType, neighborSliceType}, p.Sources)
			require.Len(t, f.calls, 5)
			for _, r := range f.calls {
				require.NotContains(t, r.URL.Path, "/pods")
			}
			if !hidden {
				baseline = p
			} else {
				require.Equal(t, baseline, p)
			}
		}
	})
	t.Run("incomplete rule review cannot certify empty sources", func(t *testing.T) {
		for _, status := range []neighborTestDoc{
			{"incomplete": true}, {"incomplete": false, "evaluationError": "private evaluation failure"}, {},
		} {
			f := newNeighborTestAPI(t, "network", "alias", "r", neighborTestDoc{"type": "ExternalName", "externalName": "approved.example"})
			status["resourceRules"] = f.rules
			f.intercept = func(r *http.Request) (int, any) {
				if strings.HasSuffix(r.URL.Path, neighborRulesPath) {
					return 201, neighborTestDoc{"apiVersion": "authorization.k8s.io/v1", "kind": "SelfSubjectRulesReview", "status": status}
				}
				return 0, nil
			}
			p, err := f.read()
			require.NoError(t, err)
			require.Equal(t, "partial", p.Coverage)
			require.Equal(t, []string{neighborServiceType}, p.Sources)
			require.Len(t, p.Rows, 1)
			require.Equal(t, "approved.example", p.Rows[0].Row["name"])
			require.Len(t, f.calls, 3)
			f.root.(neighborTestDoc)["spec"] = neighborTestDoc{}
			p, err = f.read()
			require.Equal(t, "UNAVAILABLE", resourcev2.ErrorCode(err))
			require.Nil(t, p.Rows)
		}
	})
	t.Run("failed source page", func(t *testing.T) {
		f := newNeighborTestAPI(t, "network", "svc", "r", nil)
		f.intercept = func(r *http.Request) (int, any) {
			if strings.HasSuffix(r.URL.Path, "/endpointslices") {
				return 503, "failed"
			}
			return 0, nil
		}
		p, err := f.read()
		require.NoError(t, err)
		require.Equal(t, "partial", p.Coverage)
		require.Empty(t, p.Rows)
	})
	for _, drift := range []string{"uid", "resourceVersion"} {
		t.Run("root changes "+drift, func(t *testing.T) {
			f := newNeighborTestAPI(t, "network", "svc", "r", nil)
			f.intercept = func(r *http.Request) (int, any) {
				if len(f.calls) > 1 && strings.HasSuffix(r.URL.Path, "/services/svc") {
					f.root.(neighborTestDoc)["metadata"].(neighborTestDoc)[drift] = "new"
				}
				return 0, nil
			}
			p, err := f.read()
			require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
			require.Nil(t, p.Rows)
		})
	}
	t.Run("source namespace and connection cannot be replayed", func(t *testing.T) {
		for _, mutate := range []func(*resourcev2.ReadTarget){
			func(t *resourcev2.ReadTarget) { t.Route.Connection = "other-cluster" },
			func(t *resourcev2.ReadTarget) { *t.Scope[1].Values = []string{"elsewhere"} },
			func(t *resourcev2.ReadTarget) {
				t.Scope[1] = resourcev2.ScopeConstraint{Dimension: "namespace", Match: resourcev2.ScopeAny}
			},
		} {
			f := newNeighborTestAPI(t, "network", "svc", "r", nil)
			mutate(&f.request.Sources[0])
			p, err := f.read()
			require.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(err))
			require.Nil(t, p.Rows)
			require.Empty(t, f.calls)
		}
	})
}

func TestServiceNeighborsBudgets(t *testing.T) {
	t.Run("bounded pagination reserves last root GET", func(t *testing.T) {
		f := newNeighborTestAPI(t, "network", "svc", "r", nil)
		f.intercept = func(r *http.Request) (int, any) {
			if strings.HasSuffix(r.URL.Path, "/ingresses") {
				require.Equal(t, "64", r.URL.Query().Get("limit"))
				return 200, neighborTestList("networking.k8s.io/v1", "Ingress", []any{}, strconv.Itoa(len(f.calls)))
			}
			return 0, nil
		}
		p, err := f.read()
		require.NoError(t, err)
		require.Equal(t, "partial", p.Coverage)
		require.Len(t, f.calls, 8)
		require.True(t, strings.HasSuffix(f.calls[7].URL.Path, "/services/svc"))
	})
	t.Run("65 objects not accepted as a 64 item page", func(t *testing.T) {
		f := newNeighborTestAPI(t, "network", "svc", "r", nil)
		f.ingresses = make([]any, 65)
		p, err := f.read()
		require.NoError(t, err)
		require.Equal(t, "partial", p.Coverage)
		require.NotContains(t, p.Sources, neighborIngressType)
	})
	t.Run("two MiB cumulative, even with unknown length", func(t *testing.T) {
		f := newNeighborTestAPI(t, "network", "svc", "r", nil)
		client := f.client()
		base := client.StreamingHTTPClient.Transport
		oversize := strings.NewReader(strings.Repeat("x", neighborBytes+500))
		var otherBytes int64
		client.StreamingHTTPClient.Transport = neighborTestTransport(func(r *http.Request) (*http.Response, error) {
			if strings.HasSuffix(r.URL.Path, "/endpointslices") {
				return &http.Response{StatusCode: 200, ContentLength: -1, Body: io.NopCloser(oversize)}, nil
			}
			res, err := base.RoundTrip(r)
			if err == nil {
				otherBytes += res.ContentLength
			}
			return res, err
		})
		p, err := readServiceNeighbors(t.Context(), client, f.request)
		require.NoError(t, err)
		require.Equal(t, "partial", p.Coverage)
		require.NotContains(t, p.Sources, neighborSliceType)
		require.LessOrEqual(t, int64(neighborBytes+500-oversize.Len())+otherBytes, int64(neighborBytes))
	})
	for _, total := range []int{128, 129, 130} {
		t.Run(fmt.Sprint("private overflow ", total), func(t *testing.T) {
			f := newNeighborTestAPI(t, "network", "svc", "r", nil)
			endpoints := make([]any, 0, total-1)
			for i := total - 1; i > 0; i-- {
				endpoints = append(endpoints, neighborTestDoc{"addresses": []string{fmt.Sprintf("2001:db8::%02x", i)}})
			}
			f.slices = []any{testSlice(f.ns, "ipv6", f.name, "IPv6", nil, endpoints)}
			p, err := f.read()
			require.NoError(t, err)
			require.Len(t, p.Rows, min(total, 129))
			if total > 129 {
				require.Equal(t, "partial", p.Coverage)
			} else {
				require.Equal(t, "complete", p.Coverage)
			}
			require.Equal(t, "2001:db8::01", p.Rows[1].Row["name"])
		})
	}
}

func TestServiceNeighborsCancelStopsAuthenticationAndAcquisition(t *testing.T) {
	f := newNeighborTestAPI(t, "network", "svc", "r", nil)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	p, err := readServiceNeighbors(ctx, f.client(), f.request)
	require.ErrorIs(t, err, context.Canceled)
	require.Nil(t, p.Rows)
	require.Empty(t, f.calls)

	ctx, cancel = context.WithCancel(t.Context())
	defer cancel()
	inside := make(chan struct{})
	result := make(chan error, 1)
	client := f.client()
	base := client.StreamingHTTPClient.Transport
	client.StreamingHTTPClient.Transport = neighborTestTransport(func(r *http.Request) (*http.Response, error) {
		if strings.HasSuffix(r.URL.Path, "/ingresses") {
			close(inside)
			<-r.Context().Done()
			return nil, r.Context().Err()
		}
		return base.RoundTrip(r)
	})
	go func() {
		_, err := readServiceNeighbors(ctx, client, f.request)
		result <- err
	}()
	select {
	case <-inside:
		cancel()
	case err := <-result:
		t.Fatalf("read ended before active request: %v", err)
	}
	require.ErrorIs(t, <-result, context.Canceled)
	require.Len(t, f.calls, 2, "no subsequent source or final root acquired under retired demand")
}
