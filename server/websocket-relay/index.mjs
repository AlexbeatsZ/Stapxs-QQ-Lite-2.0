import dns from 'node:dns/promises'
import http from 'node:http'
import net from 'node:net'
import { pathToFileURL } from 'node:url'

import { WebSocket, WebSocketServer } from 'ws'

export const RELAY_PATH = '/_stapxs/ws-relay'
export const HEALTH_PATH = '/_stapxs/health'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const CONTROL_MESSAGE_LIMIT = 16 * 1024
const DEFAULT_MAX_PAYLOAD = 16 * 1024 * 1024

function parseBoolean(value, fallback) {
    if (value === undefined) return fallback
    return value.toLowerCase() === 'true'
}

function stripIpv6Brackets(hostname) {
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
        return hostname.slice(1, -1)
    }
    return hostname
}

function formatHostname(hostname) {
    return net.isIP(hostname) === 6 ? `[${hostname}]` : hostname
}

export function isPrivateAddress(address) {
    const normalized = address.toLowerCase()
    if (net.isIP(normalized) === 4) {
        const octets = normalized.split('.').map(Number)
        return octets[0] === 10 ||
            octets[0] === 127 ||
            (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
            (octets[0] === 192 && octets[1] === 168) ||
            (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
    }
    if (net.isIP(normalized) === 6) {
        return normalized === '::1' ||
            normalized.startsWith('fc') ||
            normalized.startsWith('fd')
    }
    return false
}

function createPinnedLookup(addresses) {
    return (_hostname, options, callback) => {
        const normalizedOptions = typeof options === 'object' ? options : {}
        const family = Number(normalizedOptions.family || 0)
        let candidates = addresses
        if (family) {
            candidates = addresses.filter((item) => item.family === family)
        }
        if (candidates.length === 0) {
            callback(new Error(`No validated address for family ${family}`))
            return
        }
        if (normalizedOptions.all) {
            callback(null, candidates)
            return
        }
        callback(null, candidates[0].address, candidates[0].family)
    }
}

export async function prepareRelayTarget(address, options = {}) {
    const privateOnly = options.privateOnly ?? true
    const loopbackHost = options.loopbackHost ?? ''

    let original
    try {
        original = new URL(address)
    } catch {
        throw new Error('Connection address is not a valid URL')
    }
    if (!['ws:', 'wss:'].includes(original.protocol)) {
        throw new Error('Only ws:// and wss:// addresses are supported')
    }

    const originalHostname = stripIpv6Brackets(original.hostname).toLowerCase()
    const target = new URL(original.toString())
    if (loopbackHost && LOOPBACK_HOSTS.has(originalHostname)) {
        target.hostname = formatHostname(loopbackHost)
    }

    const targetHostname = stripIpv6Brackets(target.hostname)
    let lookup
    if (privateOnly) {
        if (net.isIP(targetHostname)) {
            if (!isPrivateAddress(targetHostname)) {
                throw new Error('Public target addresses are disabled by the relay')
            }
        } else {
            const addresses = await dns.lookup(targetHostname, {
                all: true,
                verbatim: true,
            })
            if (addresses.length === 0 ||
                addresses.some((item) => !isPrivateAddress(item.address))) {
                throw new Error('Target hostname does not resolve to a private address')
            }
            lookup = createPinnedLookup(addresses)
        }
    }

    return {
        url: target.toString(),
        requestOptions: {
            headers: {
                Host: original.host,
            },
            ...(lookup ? { lookup } : {}),
        },
    }
}

export function isSameOriginRequest(request) {
    const origin = request.headers.origin
    const host = request.headers.host
    if (!origin || !host) return false

    try {
        return new URL(origin).host.toLowerCase() === host.toLowerCase()
    } catch {
        return false
    }
}

function writeUpgradeError(socket, status, message) {
    socket.write(
        `HTTP/1.1 ${status}\r\n` +
        'Connection: close\r\n' +
        'Content-Type: text/plain; charset=utf-8\r\n' +
        `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n` +
        message,
    )
    socket.destroy()
}

function closeWebSocket(socket, code, reason) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.close(code, reason)
    } else if (socket.readyState === WebSocket.CONNECTING) {
        socket.terminate()
    }
}

function relayError(client, message) {
    if (client.readyState !== WebSocket.OPEN) return
    client.send(JSON.stringify({
        type: 'relay-error',
        message,
    }), () => closeWebSocket(client, 4001, 'relay error'))
}

async function handleRelayConnection(client, options) {
    let upstream
    let relayReady = false
    const connectTimeout = setTimeout(() => {
        relayError(client, 'Timed out waiting for the relay connection request')
    }, options.connectTimeoutMs)

    client.once('message', async (data, isBinary) => {
        clearTimeout(connectTimeout)
        if (isBinary || data.length > CONTROL_MESSAGE_LIMIT) {
            relayError(client, 'Invalid relay connection request')
            return
        }

        let request
        try {
            request = JSON.parse(data.toString('utf8'))
        } catch {
            relayError(client, 'Invalid relay connection request')
            return
        }
        if (request?.type !== 'relay-connect' ||
            typeof request.address !== 'string') {
            relayError(client, 'Invalid relay connection request')
            return
        }

        let target
        try {
            target = await prepareRelayTarget(request.address, options)
        } catch (error) {
            relayError(client, error instanceof Error ? error.message : String(error))
            return
        }

        upstream = new WebSocket(target.url, {
            ...target.requestOptions,
            handshakeTimeout: options.connectTimeoutMs,
            maxPayload: options.maxPayload,
        })

        upstream.once('open', () => {
            relayReady = true
            if (client.readyState !== WebSocket.OPEN) {
                closeWebSocket(upstream, 1000, 'downstream closed')
                return
            }
            client.send(JSON.stringify({ type: 'relay-open' }))
            client.on('message', (payload, binary) => {
                if (upstream?.readyState === WebSocket.OPEN) {
                    upstream.send(payload, { binary })
                }
            })
        })

        upstream.on('message', (payload, binary) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload, { binary })
            }
        })

        upstream.on('close', (code) => {
            if (client.readyState !== WebSocket.OPEN) return
            const downstreamCode = [1005, 1006, 1015].includes(code) ? 1011 : code
            closeWebSocket(client, downstreamCode, 'upstream closed')
        })

        upstream.on('error', (error) => {
            if (!relayReady) {
                relayError(client, `Target connection failed: ${error.message}`)
            } else {
                closeWebSocket(client, 1011, 'upstream error')
            }
        })
    })

    client.on('close', () => {
        clearTimeout(connectTimeout)
        if (upstream) closeWebSocket(upstream, 1000, 'downstream closed')
    })
}

export function attachWebSocketRelay(server, options = {}) {
    const relayOptions = {
        enabled: options.enabled ?? false,
        privateOnly: options.privateOnly ?? true,
        loopbackHost: options.loopbackHost ?? '',
        connectTimeoutMs: options.connectTimeoutMs ?? 10000,
        maxPayload: options.maxPayload ?? DEFAULT_MAX_PAYLOAD,
    }
    const websocketServer = new WebSocketServer({
        noServer: true,
        maxPayload: relayOptions.maxPayload,
    })

    server.on('upgrade', (request, socket, head) => {
        const pathname = new URL(request.url ?? '/', 'http://relay.local').pathname
        if (pathname !== RELAY_PATH) {
            writeUpgradeError(socket, '404 Not Found', 'Not Found')
            return
        }
        if (!relayOptions.enabled) {
            writeUpgradeError(socket, '503 Service Unavailable', 'Relay disabled')
            return
        }
        if (!isSameOriginRequest(request)) {
            writeUpgradeError(socket, '403 Forbidden', 'Origin rejected')
            return
        }

        websocketServer.handleUpgrade(request, socket, head, (client) => {
            websocketServer.emit('connection', client, request)
        })
    })

    websocketServer.on('connection', (client) => {
        handleRelayConnection(client, relayOptions).catch((error) => {
            relayError(client, error instanceof Error ? error.message : String(error))
        })
    })
    return websocketServer
}

export function createRelayServer(options = {}) {
    const server = http.createServer((request, response) => {
        const pathname = new URL(request.url ?? '/', 'http://relay.local').pathname
        if (pathname === HEALTH_PATH) {
            response.writeHead(200, { 'Content-Type': 'application/json' })
            response.end(JSON.stringify({
                relayEnabled: options.enabled ?? false,
            }))
            return
        }
        response.writeHead(404, { 'Content-Type': 'text/plain' })
        response.end('Not Found')
    })
    attachWebSocketRelay(server, options)
    return server
}

export function loadRelayOptions(environment = process.env) {
    return {
        enabled: parseBoolean(environment.SSQQ_ENABLE_WS_RELAY, false),
        privateOnly: parseBoolean(environment.SSQQ_WS_RELAY_PRIVATE_ONLY, true),
        loopbackHost: environment.SSQQ_WS_RELAY_LOOPBACK_HOST ?? '',
    }
}

const isMain = process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
    const host = process.env.SSQQ_WS_RELAY_HOST ?? '127.0.0.1'
    const port = Number(process.env.SSQQ_WS_RELAY_PORT ?? 8090)
    const options = loadRelayOptions()
    const server = createRelayServer(options)
    server.listen(port, host, () => {
        // eslint-disable-next-line no-console
        console.log(`Stapxs WebSocket relay listening on http://${host}:${port}; enabled=${options.enabled}`)
    })
}
