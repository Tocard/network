import { Wallet } from '@ethersproject/wallet'
import { fetchPrivateKeyWithGas } from '@streamr/test-utils'
import { collect } from '@streamr/utils'
import { StreamPermission } from 'streamr-client'
import { createTestClient, runCommand, startCommand } from './utils'

describe('publish and subscribe', () => {

    let publisherPrivateKey: string
    let subscriberPrivateKey: string
    let streamId: string

    beforeAll(async () => {
        publisherPrivateKey = await fetchPrivateKeyWithGas()
        subscriberPrivateKey = await fetchPrivateKeyWithGas()
        const client = createTestClient(publisherPrivateKey)
        const stream = await client.createStream(`/${Date.now()}`)
        await stream.grantPermissions({
            user: new Wallet(subscriberPrivateKey).address,
            permissions: [StreamPermission.SUBSCRIBE]
        })
        streamId = stream.id
        await client.destroy()
    }, 40 * 1000)

    function publishViaCliCommand() {
        setImmediate(async () => {
            await runCommand(`stream publish ${streamId}`, {
                inputLines: [JSON.stringify({ foo: 123 })],
                privateKey: publisherPrivateKey
            })
        })
    }

    it('happy path', async () => {
        const subscriberAbortController = new AbortController()
        const subscriberOutputIterable = startCommand(`stream subscribe ${streamId}`, {
            privateKey: subscriberPrivateKey,
            abortSignal: subscriberAbortController.signal
        })
        publishViaCliCommand()
        const receivedMessage = (await collect(subscriberOutputIterable, 1))[0]
        subscriberAbortController.abort()
        expect(JSON.parse(receivedMessage)).toEqual({
            foo: 123
        })
    }, 40 * 1000)

    it('raw subscription', async () => {
        const subscriberAbortController = new AbortController()
        const subscriberOutputIterable = startCommand(`stream subscribe ${streamId} --raw`, {
            privateKey: subscriberPrivateKey,
            abortSignal: subscriberAbortController.signal,
        })
        publishViaCliCommand()
        const receivedMessage = (await collect(subscriberOutputIterable, 1))[0]
        subscriberAbortController.abort()
        expect(receivedMessage).toMatch(/^[0-9a-fA-F]+$/)
    })

    it('with metadata', async () => {
        const subscriberAbortController = new AbortController()
        const subscriberOutputIterable = startCommand(`stream subscribe ${streamId} --with-metadata`, {
            privateKey: subscriberPrivateKey,
            abortSignal: subscriberAbortController.signal,
        })
        publishViaCliCommand()
        const receivedMessage = (await collect(subscriberOutputIterable, 1))[0]
        subscriberAbortController.abort()
        expect(JSON.parse(receivedMessage)).toMatchObject({
            message: {
                foo: 123
            },
            metadata: {
                streamId,
                streamPartition: 0,
                timestamp: expect.any(Number),
                sequenceNumber: 0,
                publisherId: expect.stringMatching(/0x[0-9a-zA-Z]+/),
                msgChainId: expect.stringMatching(/[0-9a-zA-Z]+/)
            }
        })
    })
})
