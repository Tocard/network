import { Tracker, TrackerServerEvent } from '@streamr/network-tracker'
import { NetworkNode } from '../../src/logic/NetworkNode'
import { runAndWaitForEvents } from '@streamr/test-utils'
import { InstructionMessage, toStreamID, toStreamPartID } from '@streamr/protocol'
import { Event as NodeEvent } from '../../src/logic/Node'
import { createTestNetworkNode, startTestTracker } from '../utils'

/**
 * This test verifies that tracker can send instructions to node and node will connect and disconnect based on the instructions
 */
describe('Check tracker instructions to node', () => {
    let tracker: Tracker
    let nodeOne: NetworkNode
    let nodeTwo: NetworkNode
    const streamId = toStreamID('stream-1')
    const streamPartId = toStreamPartID(streamId, 0)

    beforeAll(async () => {
        tracker = await startTestTracker({
            port: 30950
        })
        const trackerInfo = tracker.getConfigRecord()

        nodeOne = createTestNetworkNode({
            id: 'node-1',
            trackers: [trackerInfo],
            disconnectionWaitTime: 200,
            webrtcDisallowPrivateAddresses: false
        })
        nodeTwo = createTestNetworkNode({
            id: 'node-2',
            trackers: [trackerInfo],
            disconnectionWaitTime: 200,
            webrtcDisallowPrivateAddresses: false
        })

        await Promise.all([
            nodeOne.start(),
            nodeTwo.start()
        ])
        
    })

    afterAll(async () => {
        await nodeOne.stop()
        await nodeTwo.stop()
        await tracker.stop()
    })

    it('tracker should receive statuses from both nodes', (done) => {
        let receivedTotal = 0
        // @ts-expect-error private field
        tracker.trackerServer.on(TrackerServerEvent.NODE_STATUS_RECEIVED, () => {
            receivedTotal += 1

            if (receivedTotal === 2) {
                done()
            }
        })

        nodeOne.subscribe(streamPartId)
        nodeTwo.subscribe(streamPartId)
    })

    it('if tracker sends empty list of nodes, node one will disconnect from node two', async () => {
        await runAndWaitForEvents([
            () => { nodeOne.subscribe(streamPartId)},
            () => { nodeTwo.subscribe(streamPartId)}], [
            [nodeOne, NodeEvent.NODE_SUBSCRIBED],
            [nodeTwo, NodeEvent.NODE_SUBSCRIBED]
        ])

        // @ts-expect-error private field
        expect(nodeOne.streamPartManager.getNeighborsForStreamPart(streamPartId).length).toBe(1)
        // @ts-expect-error private field
        expect(nodeTwo.streamPartManager.getNeighborsForStreamPart(streamPartId).length).toBe(1)
        
        // send empty list and wait for expected events
        await runAndWaitForEvents([
            () => {
                // @ts-expect-error private field
                tracker.trackerServer.endpoint.send(
                    'node-1',
                    new InstructionMessage({
                        requestId: 'requestId',
                        streamId,
                        streamPartition: 0,
                        nodeIds: [],
                        counter: 3
                    }).serialize()
                )
            }], [
            [nodeOne, NodeEvent.NODE_UNSUBSCRIBED],
            [nodeTwo, NodeEvent.NODE_DISCONNECTED]
        ])

        // @ts-expect-error private field
        expect(nodeOne.streamPartManager.getNeighborsForStreamPart(streamPartId).length).toBe(0)
        // @ts-expect-error private field
        expect(nodeTwo.streamPartManager.getNeighborsForStreamPart(streamPartId).length).toBe(0)
    })
})
