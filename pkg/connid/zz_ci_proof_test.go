package connid

import "testing"

// Throwaway: proves that the Go checks of PRs to feature/ui-next turn red on a failing test. Never merged.
func TestCIProofGoChecksTurnRed(t *testing.T) {
	t.Fatal("throwaway failing test: the Go test job must be red")
}
