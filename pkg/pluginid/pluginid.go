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

// Version is the released plugin version. hack/package.sh stamps it at link
// time with -X github.com/omniview/kubernetes/pkg/pluginid.Version=<version>;
// unstamped builds report "dev".
var Version = "dev"

// ResourceProvider is the stable canonical resource provider, independent of the
// installation ID. SDK exec resource selectors use this provider, not ID.
const ResourceProvider = "kubernetes"
