import { StreamPartID, StreamID, StreamPartIDUtils, toStreamPartID } from '@streamr/protocol'
import { OverlayPerStreamPart, OverlayConnectionRtts } from './Tracker'
import { Location, NodeId } from '@streamr/network-node'

type OverLayWithRtts = Record<StreamPartID, Record<NodeId, { neighborId: NodeId, rtt: number | null }[] >>
type OverlaySizes = { streamId: string, partition: number, nodeCount: number }[]
type NodesWithLocations = Record<string, Location>

export function getTopology(
    overlayPerStreamPart: OverlayPerStreamPart,
    connectionRtts: OverlayConnectionRtts,
    streamId: StreamID | null = null,
    partition: number | null = null
): OverLayWithRtts {
    const topology: OverLayWithRtts = {}

    const streamParts = findStreamParts(overlayPerStreamPart, streamId, partition)
    streamParts.forEach((streamPartId) => {
        const overlay = overlayPerStreamPart[streamPartId].state()
        topology[streamPartId] = Object.assign({}, ...Object.entries(overlay).map(([nodeId, neighbors]) => {
            return addRttsToNodeConnections(nodeId, neighbors, connectionRtts)
        }))
    })

    return topology
}

export function getStreamPartSizes(
    overlayPerStreamPart: OverlayPerStreamPart,
    streamId: StreamID | null = null,
    partition: number | null = null
): OverlaySizes {
    const streamParts = findStreamParts(overlayPerStreamPart, streamId, partition)
    const sizes: OverlaySizes = streamParts.map((streamPartId) => {
        const [streamId, partition] = StreamPartIDUtils.getStreamIDAndPartition(streamPartId)
        return {
            streamId,
            partition,
            nodeCount: overlayPerStreamPart[streamPartId].getNumberOfNodes()
        }
    })
    return sizes
}

export function getNodeConnections(nodes: readonly NodeId[], overlayPerStreamPart: OverlayPerStreamPart): Record<NodeId, Set<NodeId>> {
    const result: Record<NodeId, Set<NodeId>> = {}
    nodes.forEach((node) => {
        result[node] = new Set<NodeId>()
    })
    Object.values(overlayPerStreamPart).forEach((overlayTopology) => {
        Object.entries(overlayTopology.getNodes()).forEach(([nodeId, neighbors]) => {
            neighbors.forEach((neighborNode) => {
                if (!(nodeId in result)) {
                    result[nodeId] = new Set<NodeId>()
                }
                result[nodeId].add(neighborNode)
            })
        })
    })
    return result
}

export function addRttsToNodeConnections(
    nodeId: NodeId,
    neighbors: Array<NodeId>,
    connectionRtts: OverlayConnectionRtts
): Record<NodeId, { neighborId: NodeId, rtt: number | null }[]> {
    return {
        [nodeId]: neighbors.map((neighborId) => {
            return {
                neighborId,
                rtt: getNodeToNodeConnectionRtts(nodeId, neighborId, connectionRtts[nodeId], connectionRtts[neighborId])
            }
        })
    }
}

export function getNodesWithLocationData(nodes: ReadonlyArray<string>, locations: Readonly<Record<string, Location>>): NodesWithLocations {
    return Object.assign({}, ...nodes.map((nodeId: string) => {
        return {
            [nodeId]: locations[nodeId] || {
                latitude: null,
                longitude: null,
                country: null,
                city: null,
            }
        }
    }))
}

export function findStreamsPartsForNode(
    overlayPerStreamPart: OverlayPerStreamPart,
    nodeId: NodeId
): Array<{ streamId: string, partition: number, topologySize: number }> {
    return Object.entries(overlayPerStreamPart)
        .filter(([_, overlayTopology]) => overlayTopology.hasNode(nodeId))
        .map(([streamPartId, overlayTopology]) => {
            const [streamId, partition] = StreamPartIDUtils.getStreamIDAndPartition(streamPartId as StreamPartID)
            return {
                streamId,
                partition,
                topologySize: overlayTopology.getNumberOfNodes()
            }
        })
}

function getNodeToNodeConnectionRtts(
    nodeOne: NodeId,
    nodeTwo: NodeId,
    nodeOneRtts: Record<NodeId, number>,
    nodeTwoRtts: Record<NodeId, number>
): number | null {
    try {
        return nodeOneRtts[nodeTwo] || nodeTwoRtts[nodeOne] || null
    } catch (err) {
        return null
    }
}

function findStreamParts(
    overlayPerStreamPart: OverlayPerStreamPart,
    streamId: StreamID | null = null,
    partition: number | null = null
): StreamPartID[] {
    if (streamId === null) {
        return Object.keys(overlayPerStreamPart) as StreamPartID[]
    }

    if (partition === null) {
        return Object.keys(overlayPerStreamPart)
            .filter((streamPartId) => streamPartId.includes(streamId)) as StreamPartID[]
    }
    const targetStreamPartId = toStreamPartID(streamId, partition)
    return Object.keys(overlayPerStreamPart)
        .filter((candidateStreamPartId) => targetStreamPartId === candidateStreamPartId) as StreamPartID[]

}
