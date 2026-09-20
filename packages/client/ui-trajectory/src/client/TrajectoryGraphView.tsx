import { useEffect, useMemo } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Background,
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  useNodesState,
  type Edge,
  type Node,
} from '@xyflow/react'
import { deriveTrajectoryLayout } from './layout.ts'
import { trajectoryRecordId, type TrajectoryCellProps } from './trajectory-record.ts'
import css from './TrajectoryGraphView.module.css'

function stateOf(cell: TrajectoryCellProps): 'completed' | 'failed' | 'running' {
  if (cell.isError === true) return 'failed'
  if ((cell.kind === 'tool' || cell.kind === 'subtool') && cell.result === undefined) return 'running'
  return 'completed'
}

/** Live, clickable flow view over the same records shown by Trajectory. */
export function TrajectoryGraphView({ useTrajectory, openView, t }: ConvViewProps & PropsLocale<'trajectory'>) {
  const snapshot = useTrajectory(value => value)
  const turns = useMemo(() => deriveTrajectoryLayout({
    systemPrompts: snapshot.systemPrompts,
    nodes: snapshot.eventNodes,
    eventLocations: snapshot.eventLocations,
    partial: snapshot.partial,
    runningCalls: snapshot.runningCalls,
    requests: snapshot.requests,
    callSchemas: snapshot.callSchemas,
  }, t), [snapshot, t])
  const graph = useMemo(() => {
    const records = turns.flatMap(turn => turn.groups.flatMap(group => group.cells.map(cell => ({ cell, turn: turn.turn }))))
    const nodes: Node[] = records.map(({ cell, turn }, index) => {
      const state = stateOf(cell)
      return {
        id: trajectoryRecordId(cell),
        position: { x: index * 320, y: [0, 72, -48, 36][index % 4] ?? 0 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        className: `${css.node} ${state === 'running' ? css.running : state === 'failed' ? css.failed : ''}`,
        data: {
          label: (
            <div className={css.nodeBody}>
              <span className={css.nodeHead}>
                <span>{turn === null ? t('section.betweenTurns') : t('turn.label', { turn })} · {t(`kind.${cell.kind}`)}</span>
                <small>{t(`graph.${state}`)}</small>
              </span>
              <strong>{cell.text || t('record.noContent')}</strong>
              {cell.result !== undefined && <span className={css.result}>{cell.result}</span>}
            </div>
          ),
        },
      }
    })
    const edges: Edge[] = []
    for (let index = 1; index < nodes.length; index += 1) {
      const source = nodes[index - 1]
      const target = nodes[index]
      const record = records[index]
      if (source === undefined || target === undefined || record === undefined) continue
      edges.push({
        id: `${source.id}-${target.id}`,
        source: source.id,
        target: target.id,
        type: 'bezier',
        animated: stateOf(record.cell) === 'running',
        markerEnd: { type: MarkerType.ArrowClosed },
      })
    }
    return { edges, nodes }
  }, [turns, t])
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes)

  useEffect(() => { setNodes(graph.nodes) }, [graph.nodes, setNodes])

  if (turns.length === 0) return <div className={css.empty}>{t('graph.empty')}</div>
  return (
    <div className={css.root} aria-label={t('graph.aria')}>
      <ReactFlow
        nodes={nodes}
        edges={graph.edges}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => { openView('trajectory', node.id) }}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.15, minZoom: 0.7, maxZoom: 1.2 }}
        minZoom={0.25}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--dsw-alias-border-l2)" gap={28} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
