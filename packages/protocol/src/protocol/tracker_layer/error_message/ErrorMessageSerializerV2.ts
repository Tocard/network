import TrackerMessage from '../TrackerMessage'

import ErrorMessage from './ErrorMessage'

import { Serializer } from '../../../Serializer'

const VERSION = 2

/* eslint-disable class-methods-use-this */
export default class ErrorMessageSerializerV2 extends Serializer<ErrorMessage> {
    toArray(errorMessage: ErrorMessage): (string | number)[] {
        return [
            VERSION,
            TrackerMessage.TYPES.ErrorMessage,
            errorMessage.requestId,
            errorMessage.errorCode,
            errorMessage.targetNode,
        ]
    }

    fromArray(arr: any[]): ErrorMessage {
        const [
            version,
            _type,
            requestId,
            errorCode,
            targetNode
        ] = arr

        return new ErrorMessage({
            version, requestId, errorCode, targetNode
        })
    }
}

TrackerMessage.registerSerializer(VERSION, TrackerMessage.TYPES.ErrorMessage, new ErrorMessageSerializerV2())
