# Kubernetes Plugin Guidelines

## Component composition

Prefer composition over resource-specific branches in shared components. Supply
specialized UI through typed component slots, props, or children from the owning
view. Never select behavior by resource key, kind, plugin ID, or name inside a
generic component; keep those decisions in the view that owns them.
