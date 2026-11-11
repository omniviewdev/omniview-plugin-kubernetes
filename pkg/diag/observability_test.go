package diag

import "testing"

func TestClientBuildMetricRejectsIdentifierValues(t *testing.T) {
	ClientBuild("secret_node", "secret_token")
	p := point(t, "omniview.plugin.self.client.builds", map[string]string{"operation": "other", "outcome": "other"})
	if p == nil || p.Value < 1 {
		t.Fatal("invalid attributes were not classified as other")
	}
	if point(t, "omniview.plugin.self.client.builds", map[string]string{"operation": "secret_node", "outcome": "secret_token"}) != nil {
		t.Fatal("identifier was recorded in metric attributes")
	}
}
