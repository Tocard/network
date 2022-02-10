import { Config } from './config'
import express from 'express'
import { validateConfig } from './helpers/validateConfig'
import { Schema } from 'ajv'
import { NetworkNodeStub, StreamrClient } from 'streamr-client'
import { ApiAuthenticator } from './apiAuthenticator'

export interface PluginOptions {
    name: string
    networkNode: NetworkNodeStub
    streamrClient: StreamrClient
    apiAuthenticator: ApiAuthenticator
    brokerConfig: Config
    nodeId: string
}

export abstract class Plugin<T> {

    readonly name: string
    readonly networkNode: NetworkNodeStub
    readonly streamrClient: StreamrClient
    readonly apiAuthenticator: ApiAuthenticator
    readonly brokerConfig: Config
    readonly pluginConfig: T
    readonly nodeId: string
    private readonly httpServerRouters: express.Router[] = []

    constructor(options: PluginOptions) {
        this.name = options.name
        this.networkNode = options.networkNode
        this.streamrClient = options.streamrClient
        this.apiAuthenticator = options.apiAuthenticator
        this.brokerConfig = options.brokerConfig
        this.pluginConfig = options.brokerConfig.plugins[this.name]
        this.nodeId = options.nodeId
        const configSchema = this.getConfigSchema()
        if (configSchema !== undefined) {
            validateConfig(this.pluginConfig, configSchema, `${this.name} plugin`)
        }
    }

    addHttpServerRouter(router: express.Router): void {
        this.httpServerRouters.push(router)
    }

    getHttpServerRoutes(): express.Router[] {
        return this.httpServerRouters
    }

    /**
     * This lifecycle method is called once when Broker starts
     */
    abstract start(): Promise<unknown>

    /**
     * This lifecycle method is called once when Broker stops
     * It is be called only if the plugin was started successfully
     */
    abstract stop(): Promise<unknown>

    getConfigSchema(): Schema|undefined {
        return undefined
    }
}
