package kubeauth

import (
	"testing"

	"github.com/omniview/kubernetes/pkg/connid"
	"github.com/omniview/kubernetes/pkg/connid/connidtest"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConnectionContextIsTheContextTheDataNames(t *testing.T) {
	for _, name := range []string{"prod", "arn:aws:eks:us-east-1:111122223333:cluster/prod", "odd name;$(x)"} {
		got, err := ConnectionContext(map[string]any{connid.DataKeyContext: name})

		require.NoError(t, err)
		assert.Equal(t, name, got)
	}
}

// A connection that names no context cannot be built, and the user is told so with a classification and a
// sentence, not with the "Provider operation failed" that an error with no classification becomes.
func TestConnectionContextOfADataWithNoContextIsAClassifiedErrorWithASentence(t *testing.T) {
	for label, data := range map[string]map[string]any{
		"no data":      nil,
		"no key":       {"kubeconfig": "/some/config"},
		"empty":        {connid.DataKeyContext: ""},
		"not a string": {connid.DataKeyContext: 7},
		"a list":       {connid.DataKeyContext: []string{"prod"}},
	} {
		t.Run(label, func(t *testing.T) {
			got, err := ConnectionContext(data)

			assert.Empty(t, got)
			connidtest.RequireNoContextError(t, err)
		})
	}
}
