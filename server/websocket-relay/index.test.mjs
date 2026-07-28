import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'

import { WebSocket, WebSocketServer } from 'ws'

import {
    RELAY_PATH,
    createRelayServer,
    isPrivateAddress,
    prepareRelayTarget,
} from './index.mjs'

async function listen(server) {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    return server.address().port
}

async function closeServer(server) {
    await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
    })
}

test('recognizes loopback, LAN, and Tailscale addresses as private', () => {
    assert.equal(isPrivateAddress('127.0.0.1'), true)
    assert.equal(isPrivateAddress('192.168.31.32'), true)
    assert.equal(isPrivateAddress('100.106.169.46'), true)
    assert.equal(isPrivateAddress('8.8.8.8'), false)
})

test('maps server loopback while preserving the original Host header', async () => {
    const target = await prepareRelayTarget('ws://127.0.0.1:3002/onebot?x=1', {
        loopbackHost: '192.168.65.254',
        privateOnly: true,
    })

    assert.equal(target.url, 'ws://192.168.65.254:3002/onebot?x=1')
    assert.equal(target.requestOptions.headers.Host, '127.0.0.1:3002')
})

test('rejects public targets in private-only mode', async () => {
    await assert.rejects(
        prepareRelayTarget('ws://8.8.8.8:3002/', { privateOnly: true }),
        /Public target addresses are disabled/,
    )
})

test('relays WebSocket traffic from the web server perspective', async () => {
    const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await once(upstream, 'listening')
    const upstreamPort = upstream.address().port
    upstream.on('connection', (socket) => {
        socket.on('message', (data) => socket.send(`echo:${data.toString()}`))
    })

    const relay = createRelayServer({
        enabled: true,
        privateOnly: true,
        loopbackHost: '',
        connectTimeoutMs: 2000,
    })
    const relayPort = await listen(relay)
    const client = new WebSocket(`ws://127.0.0.1:${relayPort}${RELAY_PATH}`, {
        headers: {
            Origin: `http://127.0.0.1:${relayPort}`,
        },
    })
    await once(client, 'open')
    client.send(JSON.stringify({
        type: 'relay-connect',
        address: `ws://127.0.0.1:${upstreamPort}/`,
    }))

    const [openMessage] = await once(client, 'message')
    assert.deepEqual(JSON.parse(openMessage.toString()), { type: 'relay-open' })

    client.send('hello')
    const [echoMessage] = await once(client, 'message')
    assert.equal(echoMessage.toString(), 'echo:hello')

    client.close()
    await once(client, 'close')
    await closeServer(relay)
    await new Promise((resolve) => upstream.close(resolve))
})

test('rejects cross-origin relay upgrades', async () => {
    const relay = createRelayServer({
        enabled: true,
        privateOnly: true,
    })
    const relayPort = await listen(relay)
    const client = new WebSocket(`ws://127.0.0.1:${relayPort}${RELAY_PATH}`, {
        headers: {
            Origin: 'http://example.invalid',
        },
    })

    const [error] = await once(client, 'error')
    assert.match(error.message, /403/)
    await closeServer(relay)
})
