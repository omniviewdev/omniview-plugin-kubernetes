// Package pluginid holds the ID this plugin is installed under. The SDK opens
// ~/.omniview/plugins/<ID> and requires plugin.yaml to carry the same ID, so a
// build published under another ID sets it at link time:
//
//	go build -ldflags "-X github.com/omniview/kubernetes/pkg/pluginid.ID=<id>" ./pkg
//
// hack/package.sh does this from plugin.yaml or PLUGIN_ID.
package pluginid

// ID defaults to the id in plugin.yaml.
var ID = "kubernetes"
