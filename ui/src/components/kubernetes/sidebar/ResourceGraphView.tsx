import { EmptyState, Spinner, Text, useTheme } from '@omniviewdev/base-ui';
import type { DrawerContext } from '@omniviewdev/runtime';
import { parseAppError, relationshipLabel, useResourceGraph, useRightDrawer } from '@omniviewdev/runtime';
import { ResourceClient } from '@omniviewdev/runtime/api';
import React, { useMemo, useState } from 'react';
import { LuNetwork } from 'react-icons/lu';

import type { LayoutEdge, LayoutNode } from './resourceGraphLayout';
import { NODE_HEIGHT, NODE_WIDTH, layoutGraph, truncateMiddle, useGraphDisplayNames } from './resourceGraphLayout';


const edgeColors: Record<string, string> = {
  owns: 'var(--ov-color-brand-500)',
  manages: 'var(--ov-color-brand-400)',
  runs_on: 'var(--ov-color-success)',
  uses: 'var(--ov-color-discovery)',
  selects: 'var(--ov-color-warning)',
  exposes: 'var(--ov-color-info)',
  member_of: 'var(--ov-color-secondary)',
};
const defaultEdgeColor = 'var(--ov-color-fg-subtle)';

const edgeColor = (type: string) => edgeColors[type] ?? defaultEdgeColor;

/** Characters that fit on one line of a node box at 12px. */
const NAME_CHARS = 24;

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  minHeight: 0,
};
const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 12,
  padding: '8px 12px',
  borderBottom: '1px solid var(--ov-color-border-muted)',
};
const legendItemStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const countStyle: React.CSSProperties = { marginLeft: 'auto' };
const nodeStyles = {
  root: { cursor: 'default', opacity: 1 },
  normal: { cursor: 'pointer', opacity: 1 },
  dimmed: { cursor: 'pointer', opacity: 0.35 },
} satisfies Record<string, React.CSSProperties>;
const scrollStyle: React.CSSProperties = { flex: 1, minHeight: 0, overflow: 'auto' };
const centeredStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  padding: '32px 0',
};

const GraphNodeBox: React.FC<{
  node: LayoutNode;
  dimmed: boolean;
  onOpen: (node: LayoutNode) => void;
  onHover: (key: string | null) => void;
}> = ({ node, dimmed, onOpen, onHover }) => {
  const { kind, isRoot } = node;
  const { id } = node.node.reference.address;
  const namespace = node.node.reference.address.scope.find((entry) => entry.dimension === 'namespace')?.value;
  const label = `${kind} ${namespace ? `${namespace}/` : ''}${id}`;
  const open = () => {
    if (!isRoot) onOpen(node);
  };

  return (
    <g
      transform={`translate(${node.x}, ${node.y})`}
      role={isRoot ? undefined : 'button'}
      tabIndex={isRoot ? undefined : 0}
      aria-label={label}
      style={isRoot ? nodeStyles.root : dimmed ? nodeStyles.dimmed : nodeStyles.normal}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      onMouseEnter={() => onHover(node.key)}
      onMouseLeave={() => onHover(null)}
    >
      <title>{label}</title>
      <rect
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx={6}
        fill="var(--ov-color-bg-surface-raised)"
        stroke={isRoot ? 'var(--ov-color-brand-500)' : 'var(--ov-color-border-default)'}
        strokeWidth={isRoot ? 2 : 1}
      />
      <text x={10} y={14} fontSize={10} fill="var(--ov-color-fg-muted)">
        {namespace
          ? `${kind} · ${truncateMiddle(namespace, Math.max(6, NAME_CHARS - kind.length - 3))}`
          : kind}
      </text>
      <text x={10} y={29} fontSize={12} fill="var(--ov-color-fg-default)">
        {truncateMiddle(id, NAME_CHARS)}
      </text>
    </g>
  );
};

const GraphEdgePath: React.FC<{ edge: LayoutEdge; state: 'normal' | 'active' | 'dimmed' }> = ({
  edge,
  state,
}) => (
  <path
    d={edge.path}
    fill="none"
    stroke={edgeColor(edge.edge.type)}
    strokeWidth={state === 'active' ? 2 : 1.25}
    strokeOpacity={state === 'dimmed' ? 0.15 : state === 'active' ? 1 : 0.6}
    markerEnd={`url(#ov-graph-arrow-${edge.edge.type})`}
  >
    <title>{`${edge.from.node.reference.address.id} → ${edge.to.node.reference.address.id}: ${relationshipLabel(edge.edge.type, 'outgoing')}`}</title>
  </path>
);

const ResourceGraph: React.FC<{ ctx: DrawerContext }> = ({ ctx }) => {
  const { textSize } = useTheme();
  const textScale = Number(textSize) / 100;
  const { showResourceSidebar } = useRightDrawer();
  const [hovered, setHovered] = useState<string | null>(null);
  const [pivotError, setPivotError] = useState<string | null>(null);
  const catalog = useGraphDisplayNames(ctx);

  const { graph, isLoading, error } = useResourceGraph({
    pluginID: ctx.resource?.pluginID,
    reference: ctx.resource!.reference,
    route: ctx.resource!.route,
  });

  const layout = useMemo(() => (graph ? layoutGraph(graph, catalog.data) : null), [graph, catalog.data]);
  const edgeTypes = useMemo(
    () => [...new Set(layout?.edges.map((e) => e.edge.type) ?? [])].sort(),
    [layout],
  );

  if (isLoading && !error) {
    return (
      <div style={centeredStyle}>
        <Spinner size="sm" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        size="sm"
        icon={<LuNetwork />}
        title="Could not load the resource graph"
        description={parseAppError(error).detail}
      />
    );
  }

  if (!graph || !layout) {
    return (
      <EmptyState
        size="sm"
        icon={<LuNetwork />}
        title="No relationships to draw"
        description="Relationships come from owner references, node assignment, volumes, references and selectors of resources Omniview is watching."
      />
    );
  }

  const open = async (n: LayoutNode) => {
    setPivotError(null);
    try {
      const { reference, route } = n.node;
      const resolved = await ResourceClient.ResolveReference(n.node.pluginId, {
        route,
        type: reference.address.type,
        scope: reference.address.scope,
        id: reference.address.id,
        incarnation: reference.incarnation,
      });
      await showResourceSidebar({
        pluginID: n.node.pluginId,
        reference,
        route,
        representation: resolved.representation,
        targetId: resolved.targetId,
        resourceName: reference.address.id,
      });
    } catch (error) {
      setPivotError(error instanceof Error ? error.message : String(error));
    }
  };

  const touches = (e: LayoutEdge) =>
    hovered !== null && (e.from.key === hovered || e.to.key === hovered);
  const neighbours = new Set<string>();
  if (hovered) {
    for (const e of layout.edges) {
      if (touches(e)) {
        neighbours.add(e.from.key);
        neighbours.add(e.to.key);
      }
    }
  }

  return (
    <div style={containerStyle}>
      {pivotError && <div role="alert"><Text tone="muted">{`Could not open resource: ${pivotError}`}</Text></div>}
      <div style={toolbarStyle}>
        {edgeTypes.map((type) => (
          <span key={type} style={legendItemStyle}>
            <svg width={18} height={6} aria-hidden>
              <line x1={0} y1={3} x2={18} y2={3} stroke={edgeColor(type)} strokeWidth={2} />
            </svg>
            <Text size="xs" tone="muted">
              {relationshipLabel(type, 'outgoing')}
            </Text>
          </span>
        ))}
        <Text size="xs" tone="subtle" style={countStyle}>
          {`${layout.nodes.length} resources${graph.truncated ? ' (limit reached, some left out)' : ''}`}
        </Text>
      </div>
      <div style={scrollStyle}>
        <svg
          width={layout.width * textScale}
          height={layout.height * textScale}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label="Resource relationship graph"
        >
          <defs>
            {edgeTypes.map((type) => (
              <marker
                key={type}
                id={`ov-graph-arrow-${type}`}
                viewBox="0 0 10 10"
                refX={9}
                refY={5}
                markerWidth={7}
                markerHeight={7}
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={edgeColor(type)} />
              </marker>
            ))}
          </defs>
          {layout.edges.map((e) => (
            <GraphEdgePath
              key={e.key}
              edge={e}
              state={hovered === null ? 'normal' : touches(e) ? 'active' : 'dimmed'}
            />
          ))}
          {layout.nodes.map((n) => (
            <GraphNodeBox
              key={n.key}
              node={n}
              dimmed={hovered !== null && !neighbours.has(n.key)}
              onOpen={(node) => { void open(node); }}
              onHover={setHovered}
            />
          ))}
        </svg>
      </div>
    </div>
  );
};

/**
 * Sidebar view drawing the open resource's neighbourhood in the host's
 * relationship graph: owners and selectors on the left, the resource, then
 * what it depends on. Clicking a resource opens its sidebar.
 */
const ResourceGraphView: React.FC<{ ctx: DrawerContext }> = ({ ctx }) => {
  if (!ctx.resource) {
    return <EmptyState size="sm" icon={<LuNetwork />} title="Resource target is unavailable" />;
  }

  return <ResourceGraph ctx={ctx} />;
};

export default ResourceGraphView;
