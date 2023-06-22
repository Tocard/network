import { MessageID, MessageRef, StreamMessage, StreamPartIDUtils, toStreamID } from '@streamr/protocol'
import { Defer, EthereumAddress, toEthereumAddress } from '@streamr/utils'
import assert from 'assert'
import { shuffle } from 'lodash'
import { createSignedMessage } from '../../src/publish/MessageFactory'
import { MsgChainContext, OrderedMsgChain } from '../../src/subscribe/ordering/OrderedMsgChain'
import { createRandomAuthentication } from '../test-utils/utils'

const DEFAULT_GAP_FILL_TIMEOUT = 5000
const DEFAULT_RETRY_RESEND_AFTER = 5000
const DEFAULT_MAX_GAP_REQUESTS = 10

const authentication = createRandomAuthentication()

const CONTEXT = {
    streamPartId: StreamPartIDUtils.parse('stream#0'),
    publisherId: toEthereumAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    msgChainId: 'msgChainId'
}

/**
 * Split an array into numChunks chunks.
 * Sort of the opposite of flatMap.
 * e.g.
 * splitArrayIntoChunks([1,2,3,4,5,6], 3) => [[1,2],[3,4],[5,6]]
 * splitArrayIntoChunks([1,2,3,4,5], 3) => [[1,2],[3,4],[5]]
 * splitArrayIntoChunks([1,2,3,4,5], 2) => [[1,2,3],[4,5]]
 */
function splitArrayIntoChunks<T>(array: T[], numChunks = 1): T[][] {
    const { length } = array
    const size = Math.max(Math.ceil(length / numChunks), 0)
    if (!length || size < 1) {
        return []
    }

    const result = []
    for (let i = 0; i < length; i += size) {
        result.push(array.slice(i, i + size))
    }
    return result
}

const createMsg = async ({
    timestamp = 1,
    sequenceNumber = 0,
    prevTimestamp = null,
    prevSequenceNumber = 0,
    content = {},
    publisherId = CONTEXT.publisherId,
    msgChainId = CONTEXT.msgChainId
}: {
    timestamp?: number
    sequenceNumber?: number
    prevTimestamp?: number | null
    prevSequenceNumber?: number
    content?: Record<string, unknown>
    publisherId?: EthereumAddress
    msgChainId?: string
} = {}) => {
    const prevMsgRef = prevTimestamp ? new MessageRef(prevTimestamp, prevSequenceNumber) : null
    return createSignedMessage({
        messageId: new MessageID(toStreamID('streamId'), 0, timestamp, sequenceNumber, publisherId, msgChainId),
        prevMsgRef,
        serializedContent: JSON.stringify(content),
        authentication
    })
}

describe('OrderedMsgChain', () => {
    let msg1: StreamMessage
    let msg2: StreamMessage
    let msg3: StreamMessage
    let msg4: StreamMessage
    let msg5: StreamMessage
    let msg6: StreamMessage
    let util: OrderedMsgChain

    beforeEach(async () => {
        msg1 = await createMsg({ timestamp: 1, sequenceNumber: 0 })
        msg2 = await createMsg({ timestamp: 2, sequenceNumber: 0, prevTimestamp: 1, prevSequenceNumber: 0 })
        msg3 = await createMsg({ timestamp: 3, sequenceNumber: 0, prevTimestamp: 2, prevSequenceNumber: 0 })
        msg4 = await createMsg({ timestamp: 4, sequenceNumber: 0, prevTimestamp: 3, prevSequenceNumber: 0 })
        msg5 = await createMsg({ timestamp: 5, sequenceNumber: 0, prevTimestamp: 4, prevSequenceNumber: 0 })
        msg6 = await createMsg({ timestamp: 6, sequenceNumber: 0, prevTimestamp: 5, prevSequenceNumber: 0 })
    })

    afterEach(() => {
        util.clearGap()
    })

    it('handles ordered messages in order', () => {
        const received: StreamMessage[] = []
        const onDrain = jest.fn()
        util = new OrderedMsgChain(CONTEXT, (msg: StreamMessage) => {
            received.push(msg)
        }, () => {
            throw new Error('Unexpected gap')
        }, onDrain, () => {}, DEFAULT_GAP_FILL_TIMEOUT, DEFAULT_RETRY_RESEND_AFTER, DEFAULT_MAX_GAP_REQUESTS)
        util.add(msg1)
        util.add(msg2)
        util.add(msg3)
        assert.deepStrictEqual(received, [msg1, msg2, msg3])
        expect(onDrain).toHaveBeenCalledTimes(0) // should not call if queue doesn't grow larger than one
    })

    it('handles unordered messages in order', () => {
        const received: StreamMessage[] = []
        const onDrain = jest.fn()
        util = new OrderedMsgChain(CONTEXT, (msg: StreamMessage) => {
            received.push(msg)
        }, () => {}, onDrain, () => {}, DEFAULT_GAP_FILL_TIMEOUT, DEFAULT_RETRY_RESEND_AFTER, DEFAULT_MAX_GAP_REQUESTS)
        util.add(msg1)
        util.add(msg2)
        util.add(msg5)
        util.add(msg3)
        util.add(msg4)
        assert.deepStrictEqual(received, [msg1, msg2, msg3, msg4, msg5])
        expect(onDrain).toHaveBeenCalledTimes(1) // should have queued > 1
    })

    it('handles unchained messages in the order in which they arrive if they are newer', async () => {
        const onDrain = jest.fn()
        // NOTE: this behaviour isn't ideal, perhaps debounce in the hope that
        // a better ordering appears?  When unchained messages arrive they just
        // get immediately processed so if you add 3 unchained messages
        // out-of-order in the same tick: [msg1, msg3, msg2] msg2 will always
        // vanish.
        //
        // Unchained messages don't have a prevMsgRef, so it doesn't know to
        // request a gapfill or that if it just waited for a moment it might
        // get a better ordering Perhaps we could add a momentary delay for
        // unchained, or even initial messages, in the hopes that more ordered
        // messages will arrive shortly
        const m2 = await createMsg({ timestamp: 4, sequenceNumber: 0 })
        const m3 = await createMsg({ timestamp: 7, sequenceNumber: 0 })
        const m4 = await createMsg({ timestamp: 17, sequenceNumber: 0 })
        const received: StreamMessage[] = []
        util = new OrderedMsgChain(CONTEXT, (msg: StreamMessage) => {
            received.push(msg)
        }, () => {}, onDrain, () => {}, DEFAULT_GAP_FILL_TIMEOUT, DEFAULT_RETRY_RESEND_AFTER, DEFAULT_MAX_GAP_REQUESTS)
        util.add(msg1)
        util.add(m2)
        util.add(m4)
        util.add(m3) // thhis should be dropped because m4 was newer
        assert.deepStrictEqual(received, [msg1, m2, m4])
        expect(onDrain).toHaveBeenCalledTimes(0) // nothing should have queued
    })

    it('handles unchained messages arriving that fill a gap', async () => {
        const done = new Defer<undefined>()
        const unchainedMsg2 = await createMsg({ timestamp: 2, sequenceNumber: 0 })
        const received: StreamMessage[] = []
        const onDrain = () => {
            expect(received).toEqual([msg1, unchainedMsg2, msg3])
            done.resolve(undefined)
        }
        util = new OrderedMsgChain(CONTEXT, (msg: StreamMessage) => {
            received.push(msg)
        }, () => {
            util.add(unchainedMsg2)
        }, onDrain, () => {}, 10, 10, DEFAULT_MAX_GAP_REQUESTS)

        util.add(msg1)
        util.add(msg3)
        await done
    })

    it('handles out-of-order unchained messages arriving that partially fill a gap', async () => {
        const done = new Defer<undefined>()
        // ensures unchained messages don't break anything during gapfill
        // take a chain with multiple gaps, and fill them in reverse order using unchained messages.
        const unchainedMsg2 = await createMsg({ timestamp: 2, sequenceNumber: 0 })
        const unchainedMsg4 = await createMsg({ timestamp: 4, sequenceNumber: 0 })
        const received: StreamMessage[] = []
        let count = 0
        const onDrain = () => {
            expect(received).toEqual([msg1, unchainedMsg2, msg3, unchainedMsg4, msg5])
            done.resolve(undefined)
        }
        util = new OrderedMsgChain(CONTEXT, (msg: StreamMessage) => {
            received.push(msg)
        }, () => {
            count += 1
            switch (count) {
                case 1: {
                    // 2. fill second gap first,
                    // should retry gapfill on first gap
                    util.add(unchainedMsg4)
                    util.add(unchainedMsg4) // bonus: also check it drops duplicate unchained
                    break
                }
                case 2: {
                    // 3. on retry, filling first gap completes sequence
                    util.add(unchainedMsg2)
                    break
                }
                default: {
                    // noop
                }
            }
        }, onDrain, () => {}, 10, 10, DEFAULT_MAX_GAP_REQUESTS)

        // 1. add chain with multiple gaps
        util.add(msg1)
        util.add(msg3)
        util.add(msg5)
        await done
    })

    it('drops duplicates', () => {
        const received: StreamMessage[] = []
        util = new OrderedMsgChain(CONTEXT, (msg: StreamMessage) => {
            received.push(msg)
        }, () => {
            throw new Error('Unexpected gap')
        }, () => {}, () => {}, DEFAULT_GAP_FILL_TIMEOUT, DEFAULT_RETRY_RESEND_AFTER, DEFAULT_MAX_GAP_REQUESTS)
        util.add(msg1)
        util.add(msg1)
        util.add(msg2)
        util.add(msg1)
        util.add(msg2)
        assert.deepStrictEqual(received, [msg1, msg2])
    })

    it('drops duplicates after gap', (done) => {
        const onDrain = jest.fn()
        const received: StreamMessage[] = []
        util = new OrderedMsgChain(CONTEXT, (msg: StreamMessage) => {
            received.push(msg)
        }, () => {
            util.add(msg3) // fill gap
            setTimeout(() => {
                assert.deepStrictEqual(received, [msg1, msg2, msg3, msg4])
                expect(onDrain).toHaveBeenCalledTimes(1) // nothing should have queued
                done()
            }, 0)
        }, onDrain, () => {}, 50, DEFAULT_RETRY_RESEND_AFTER, DEFAULT_MAX_GAP_REQUESTS)
        util.add(msg1)
        util.add(msg2)
        // duplicate messages after gap
        util.add(msg4)
        util.add(msg4)
    })

    it('calls the gap handler', (done) => {
        const received: StreamMessage[] = []
        util = new OrderedMsgChain(CONTEXT, (msg: StreamMessage) => {
            received.push(msg)
        }, (from: MessageRef, to: MessageRef, context: MsgChainContext) => {
            assert.deepStrictEqual(received, [msg1, msg2])
            assert.strictEqual(from.timestamp, msg2.getMessageRef().timestamp)
            assert.strictEqual(from.sequenceNumber, msg2.getMessageRef().sequenceNumber + 1)
            assert.deepStrictEqual(to, msg5.prevMsgRef)
            assert.strictEqual(context, CONTEXT)
            util.clearGap()
            done()
        }, () => {}, () => {}, 50, DEFAULT_RETRY_RESEND_AFTER, DEFAULT_MAX_GAP_REQUESTS)
        util.add(msg1)
        util.add(msg2)
        util.add(msg5)
    })

    it('does not call the gap handler (scheduled but resolved before timeout)', () => {
        const received: StreamMessage[] = []
        util = new OrderedMsgChain(CONTEXT, (msg: StreamMessage) => {
            received.push(msg)
        }, () => {
            throw new Error('Unexpected gap')
        }, () => {}, () => {}, 10000, DEFAULT_RETRY_RESEND_AFTER, DEFAULT_MAX_GAP_REQUESTS)
        util.add(msg1)
        util.add(msg5)
        util.add(msg4)
        util.add(msg3)
        util.add(msg2)
        assert.deepStrictEqual(received, [msg1, msg2, msg3, msg4, msg5])
    })

    it('does not call the gap handler again while async gap handler is pending', (done) => {
        const received: StreamMessage[] = []
        const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

        const WAIT = 100
        let count = 0
        const onDrain = () => {
            try {
                assert.strictEqual(count, 1)
                assert.deepStrictEqual(received, [msg1, msg2, msg3, msg4, msg5])
                done()
            } catch (err) {
                done(err)
            }
        }
        util = new OrderedMsgChain(CONTEXT, (msg: StreamMessage) => {
            received.push(msg)
        }, async () => {
            count += 1
            await wait(WAIT * 3)
            util.add(msg2)
        }, onDrain, () => {}, WAIT, WAIT, DEFAULT_MAX_GAP_REQUESTS)

        util.add(msg1)
        // msg2 missing
        util.add(msg3)
        util.add(msg4)
        util.add(msg5)
    })

    it('does not call the gap handler a second time if explicitly cleared', (done) => {
        let counter = 0
        util = new OrderedMsgChain(CONTEXT, () => {}, () => {
            if (counter === 0) {
                counter += 1
                util.clearGap()
                setTimeout(done, 1000)
            } else {
                throw new Error('Unexpected call to the gap handler')
            }
        }, () => {}, () => {}, 100, 100, DEFAULT_MAX_GAP_REQUESTS)
        util.add(msg1)
        util.add(msg3)
    })

    it('does not call the gap handler again if disabled', (done) => {
        let counter = 0
        const msgs: StreamMessage[] = []
        util = new OrderedMsgChain(CONTEXT, (msg) => {
            msgs.push(msg)
            if (msgs.length === 3) {
                try {
                    // should have seen messages 1, 3, 5
                    expect(msgs).toEqual([msg1, msg3, msg5])
                    done()
                } catch (err) {
                    done(err)
                }
            }
        }, () => {
            counter += 1
            if (counter === 1) {
                util.disable()
            } else {
                throw new Error('Unexpected call to the gap handler')
            }
        }, () => {}, () => {}, 100, 100, DEFAULT_MAX_GAP_REQUESTS)
        util.add(msg1)
        util.add(msg3)
        util.add(msg5)
    })

    it('does not call the gap handler if disabled', (done) => {
        const msgs: StreamMessage[] = []
        util = new OrderedMsgChain(CONTEXT, (msg) => {
            msgs.push(msg)
            if (msgs.length === 3) {
                try {
                    // should have seen messages 1, 3, 5
                    expect(msgs).toEqual([msg1, msg3, msg5])
                    done()
                } catch (err) {
                    done(err)
                }
            }
        }, () => {
            throw new Error('Unexpected call to the gap handler')
        }, () => {}, () => {}, 100, 100, DEFAULT_MAX_GAP_REQUESTS)
        util.disable()
        util.add(msg1)
        util.add(msg3)
        util.add(msg5)
    })

    it('can handle multiple gaps', (done) => {
        const msgs: StreamMessage[] = []
        util = new OrderedMsgChain(CONTEXT, (msg: StreamMessage) => {
            msgs.push(msg)
            if (msgs.length === 5) {
                assert.deepStrictEqual(msgs, [msg1, msg2, msg3, msg4, msg5])
                done()
            }
        }, (_from: MessageRef, to: MessageRef) => {
            if (to.timestamp === 2) {
                setTimeout(() => {
                    util.add(msg2)
                }, 25)
            }

            if (to.timestamp === 4) {
                util.add(msg4)
            }
        }, () => {}, done, 100, 100, DEFAULT_MAX_GAP_REQUESTS)

        util.add(msg1)
        // missing msg2
        util.add(msg3)
        // missing msg4
        util.add(msg5)
    })

    describe('maxGapRequests', () => {
        it('call the gap handler maxGapRequests times and then fails with error', (done) => {
            let counter = 0
            const onError = () => {
                // @ts-expect-error private method
                expect(counter).toBe(util.maxGapRequests)
                done()
            }
            util = new OrderedMsgChain(
                CONTEXT, 
                () => {}, 
                (from: MessageRef, to: MessageRef, context: MsgChainContext) => {
                    assert.strictEqual(from.timestamp, msg1.getMessageRef().timestamp)
                    assert.strictEqual(from.sequenceNumber, msg1.getMessageRef().sequenceNumber + 1)
                    assert.deepStrictEqual(to, msg3.prevMsgRef)
                    assert.strictEqual(context, CONTEXT)
                    counter += 1
                }, 
                () => {}, onError, 100, 100, DEFAULT_MAX_GAP_REQUESTS)
            util.add(msg1)
            util.add(msg3)
        })

        it('after maxGapRequests OrderingUtil gives up on filling gap with "error" event', (done) => {
            const received: StreamMessage[] = []
            const onGap = jest.fn()
            let onErrorCallCount = 0
            const onError = () => {
                onGap()
                if (onErrorCallCount === 0) {
                    setImmediate(() => {
                        util.add(msg6)
                    })
                } else if (onErrorCallCount === 1) {
                    setImmediate(() => {
                        assert.deepStrictEqual(received, [msg1, msg3, msg4, msg6])
                        // @ts-expect-error private method
                        expect(util.queue.size()).toEqual(0)
                        expect(util.isEmpty()).toEqual(true)
                        // @ts-expect-error private method
                        expect(util.hasPendingGap).toEqual(false)
                        expect(onGap).toHaveBeenCalledTimes(2)
                        done()
                    })
                }
                onErrorCallCount++
            }
            util = new OrderedMsgChain(CONTEXT, (msg: StreamMessage) => {
                received.push(msg)
            }, () => {}, () => {}, onError, 5, 5, DEFAULT_MAX_GAP_REQUESTS)

            util.add(msg1)
            util.add(msg3)
            util.add(msg4)
        })
    })

    it('handles unordered messages in order (large randomized test)', async () => {
        const expected = [msg1]
        for (let i = 2; i <= 1000; i++) {
            expected.push(await createMsg({ timestamp: i, sequenceNumber: 0, prevTimestamp: i - 1, prevSequenceNumber: 0 }))
        }
        const shuffled = shuffle(expected)
        const received: StreamMessage[] = []
        util = new OrderedMsgChain(CONTEXT, (msg: StreamMessage) => {
            received.push(msg)
        }, () => {}, () => {}, () => {}, 50, DEFAULT_RETRY_RESEND_AFTER, DEFAULT_MAX_GAP_REQUESTS)
        util.add(msg1)
        shuffled.forEach((msg) => {
            util.add(msg)
        })

        try {
            assert.deepStrictEqual(received, expected)
        } catch (e) {
            const timestamps: number[] = []
            expected.forEach((streamMessage: StreamMessage) => {
                timestamps.push(streamMessage.getTimestamp())
            })
            const receivedTimestamps: number[] = []
            received.forEach((streamMessage: StreamMessage) => {
                receivedTimestamps.push(streamMessage.getTimestamp())
            })
            throw new Error('Was expecting to receive messages ordered per timestamp but instead received timestamps in this '
                + `order:\n${receivedTimestamps}.\nThe unordered messages were processed in the following timestamp order:\n${timestamps}`)
        }
    })

    it('handles unordered messages in order with gapfill (large randomized test)', async () => {
        const done = new Defer<undefined>()
        // this test breaks a large number of messages in random order, with duplicates, into chunks
        // each time queue is drained or gap is detected, it adds the next chunk of messages.
        const expected = [msg1]
        const NUM_CHUNKS = 12
        for (let i = 2; i <= 1000; i++) {
            expected.push(await createMsg({
                timestamp: i,
                sequenceNumber: 0,
                prevTimestamp: i - 1,
                prevSequenceNumber: 0
            }))
        }
        // some number of the original messages get duplicated at random
        const DUPLICATE_FACTOR = 1 / 3
        const duplicates = shuffle(expected).slice(0, expected.length * DUPLICATE_FACTOR)
        // mix duplicates with original and shuffle it all up
        const shuffled = shuffle([...duplicates, ...expected])
        // split into chunks
        const chunks = splitArrayIntoChunks(shuffled, NUM_CHUNKS)

        let debugTimer: ReturnType<typeof setTimeout>

        // get next chunk or verify we're done
        function next() {
            const result = nextChunk()
            if (result) {
                return
            }
            setTimeout(() => {
                checkDone()
            }, 0)
        }

        function nextChunk() {
            const items = chunks.pop()
            if (!items) { return false }
            items.forEach((msg) => {
                util.add(msg)
            })
            return true
        }

        function checkDone() {
            clearTimeout(debugTimer)
            try {
                expect(received).toEqual(expected)
            } catch (e) {
                const timestamps: number[] = []
                expected.forEach((streamMessage: StreamMessage) => {
                    timestamps.push(streamMessage.getTimestamp())
                })
                const receivedTimestamps: number[] = []
                received.forEach((streamMessage: StreamMessage) => {
                    receivedTimestamps.push(streamMessage.getTimestamp())
                })

                expect(received)
                done.reject(new Error('Was expecting to receive messages ordered per timestamp but instead received timestamps in this '
                    + `order:\n${receivedTimestamps}.\nThe unordered messages were processed in the following timestamp order:\n${timestamps}`))
                return
            }
            done.resolve(undefined)
        }

        const received: StreamMessage[] = []

        util = new OrderedMsgChain(CONTEXT, (msg: StreamMessage) => {
            received.push(msg)
            clearTimeout(debugTimer)
        }, () => {
            next()
        }, next, () => {}, 10, 10, NUM_CHUNKS * 2)

        // important: add first message first
        util.add(msg1)

        next()
        await done
    }, 10000)
})
