import { PeerId, PeerInfo } from '../PeerInfo'
import { Rtts } from '../../identifiers'

export enum Event {
    PEER_CONNECTED = 'streamr:peer:connect',
    PEER_DISCONNECTED = 'streamr:peer:disconnect',
    MESSAGE_RECEIVED = 'streamr:message-received',
    HIGH_BACK_PRESSURE = 'streamr:high-back-pressure',
    LOW_BACK_PRESSURE = 'streamr:low-back-pressure'
}

export interface IWebRtcEndpoint {

    // Declare event handlers
    on(event: Event.PEER_CONNECTED, listener: (peerInfo: PeerInfo) => void): this
    on(event: Event.PEER_DISCONNECTED, listener: (peerInfo: PeerInfo) => void): this
    on(event: Event.MESSAGE_RECEIVED, listener: (peerInfo: PeerInfo, message: string) => void): this
    on(event: Event.HIGH_BACK_PRESSURE, listener: (peerInfo: PeerInfo) => void): this
    on(event: Event.LOW_BACK_PRESSURE, listener: (peerInfo: PeerInfo) => void): this

    connect(targetPeerId: PeerId, routerId: string, trackerInstructed: boolean): Promise<PeerId>
    send(targetPeerId: PeerId, message: string): Promise<void>
    close(receiverPeerId: PeerId, reason: string): void
    getRtts(): Readonly<Rtts>
    getPeerInfo(): Readonly<PeerInfo>
    getAddress(): string
    stop(): void
    getNegotiatedMessageLayerProtocolVersionOnNode(peerId: PeerId): number | undefined
    getNegotiatedControlLayerProtocolVersionOnNode(peerId: PeerId): number | undefined
    getDefaultMessageLayerProtocolVersion(): number
    getDefaultControlLayerProtocolVersion(): number
    getAllConnectionNodeIds(): PeerId[]
    getDiagnosticInfo(): Record<string, unknown>
}
