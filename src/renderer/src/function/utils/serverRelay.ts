export const SERVER_RELAY_PATH = '/_stapxs/ws-relay'

export type ServerRelayControlMessage =
    | { type: 'relay-open' }
    | { type: 'relay-error', message: string }

export function isServerRelayDefaultEnabled(document: Document) {
    return document.querySelector(
        'meta[name="stapxs-ws-relay"][content="enabled"]',
    ) !== null
}

export function getServerRelayUrl(location: Pick<Location, 'host' | 'protocol'>) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${location.host}${SERVER_RELAY_PATH}`
}

export function createServerRelayConnectMessage(address: string) {
    return JSON.stringify({
        type: 'relay-connect',
        address,
    })
}

export function parseServerRelayControlMessage(data: unknown):
ServerRelayControlMessage | undefined {
    if (typeof data !== 'string') return undefined

    try {
        const message = JSON.parse(data) as Partial<ServerRelayControlMessage>
        if (message.type === 'relay-open') {
            return { type: 'relay-open' }
        }
        if (message.type === 'relay-error' && typeof message.message === 'string') {
            return {
                type: 'relay-error',
                message: message.message,
            }
        }
    } catch (e) {
        if (!(e instanceof SyntaxError)) throw e
    }
    return undefined
}
