import assert from 'node:assert/strict'
import test from 'node:test'
import { loadForwardingRuntime, loadForwardingConnector, flushForwarding, message } from './helpers/forwarding-runtime.mjs'
import { prepareForwardMessage, snapshotForwardMessages } from '../src/renderer/src/function/utils/forwardMessage.ts'
import { reconcileSentMessage } from '../src/renderer/src/function/utils/sentMessage.ts'
import { getOneBotResponseError } from '../src/renderer/src/function/utils/fileTransferUtil.ts'

async function setup(extra = {}) {
    const chat = { chatInfo: { show: { id: 20, type: 'group' } }, messageList: [] }
    const ui = { msgType: 1, popBoxList: [] }
    const auth = { loginInfo: { uin: 99, nickname: 'self' }, jsonMap: { message_list: {}, get_message: {} } }
    const contacts = { userList: [], baseOnMsgList: new Map() }
    const calls = [], errors = []
    let uuid = 0
    const runtime = {
        $t: (text, values = {}) => text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? key),
        chatStore: chat, uiStore: ui, authStore: auth, contactStore: contacts,
        chat: { show: chat.chatInfo.show }, list: [], details: { value: [{}, {}, {}, { open: false }] },
        tags: { value: { search: { list: [] } } },
        selectedForwardAction: { value: 'individual-messages' }, selectedMsg: { value: null },
        multipleSelectList: { value: [] }, toRaw: value => value, markRaw: value => value,
        cancelForward: () => {}, nextTick: () => {}, document: {}, MsgBody: {},
        useChatStore: () => chat, useAuthStore: () => auth, useUIStore: () => ui,
        useContactStore: () => contacts, useSettingsStore: () => ({ sysConfig: {} }),
        getMsgRawTxt: item => item.raw_message ?? '', updateBaseOnMsgList: () => {},
        findSessionContact: () => undefined, uuid: () => `uuid-${++uuid}`,
        BotMsgType: { Array: 1 }, sendStatEvent: () => {},
        Connector: { send: (...args) => calls.push(args) },
        getOneBotResponseError, prepareForwardMessage, snapshotForwardMessages, reconcileSentMessage,
        PopInfo: class { add(...args) { errors.push(args) } }, PopType: { ERR: 'error', INFO: 'info' },
        logger: { error: (...args) => errors.push(args) },
        popInfo: { add: (...args) => errors.push(args) }, app: { config: { globalProperties: { $t: text => text } } },
        getMsgData: (key, payload) => key === 'message_info' ? [{ message_id: payload.message_id, sender: payload.sender.user_id,
            group_id: payload.group_id, private_id: payload.user_id }] : payload,
        buildMsgList: messages => messages, getMessageList: async messages => messages,
        msgPath: { message_info: {}, message_list: {} },
        Option: { get: () => undefined }, refreshFavicon: () => {},
        normalizeNewIncomingMessage: data => [data], saveMessagesWithSideEffects: () => {},
        saveMsg: () => {}, randomNum: () => 0, resolveIncomingSession: () => undefined,
        LogType: { DEBUG: 'debug', INFO: 'info' },
        setTimeout: () => {}, ...extra,
    }
    const api = await loadForwardingRuntime(runtime)
    return { api, runtime, chat, ui, auth, contacts, calls, errors }
}

test('a get_msg reply updates its own placeholder even when replies arrive backwards', async () => {
    const t = await setup()
    const first = message(101, 'pending first', { fake_message_id: 'uuid-1', fake_msg: false })
    const second = message(102, 'pending second', { fake_message_id: 'uuid-2', fake_msg: false })
    t.chat.messageList = [message(1, 'history'), first, second]
    t.api.getSendMsg('', { status: 'ok', data: message(101, 'delivered first') }, ['getSendMsg', '101', 'uuid-1'])
    await flushForwarding()
    assert.equal(first.message[0].text, 'delivered first')
    assert.equal(second.message[0].text, 'pending second')
    t.api.getSendMsg('', { status: 'ok', data: message(102, 'delivered second') }, ['getSendMsg', '102', 'uuid-2'])
    await flushForwarding()
    assert.equal(second.message[0].text, 'delivered second')
    assert.equal(t.chat.messageList[0].raw_message, 'history')
})

test('the production self-event handler preserves history and does not consume unrelated pending messages', async () => {
    const t = await setup()
    const first = message(101, 'pending first', { fake_message_id: 'uuid-1', fake_msg: false })
    const second = message(102, 'pending second', { fake_message_id: 'uuid-2', fake_msg: false })
    t.chat.messageList = [message(1, 'history'), first, second]
    t.api.newMsg('', message(101, 'delivered first'))
    assert.equal(first.message[0].text, 'delivered first')
    assert.equal(second.message[0].text, 'pending second')
    assert.deepEqual(t.chat.messageList.map(item => item.message_id), [1, 101, 102])
    t.api.newMsg('', message(999, 'other chat', { group_id: 30 }))
    assert.equal(second.message[0].text, 'pending second')
    assert.deepEqual(t.chat.messageList.map(item => item.message_id), [1, 101, 102])
})

test('legacy sends await their own echo in WebSocket and HTTP modes without leaking responses', async () => {
    for (const sseMode of ['false', 'true']) {
        const sent = [], dispatched = []
        const connector = await loadForwardingConnector({
            sseMode, logger: { add: () => {} }, TimeoutError: class extends Error {},
            dispatch: (data, echo) => { dispatched.push(echo); data.message_id = 'UI-only change' },
        })
        connector.sendRaw = (...args) => sent.push(['ws', ...args])
        connector.sendSeeMod = (...args) => sent.push(['http', ...args])
        const first = connector.sendAndWait('send_msg', {}, 'sendMsgBack_uuid_a', 1000)
        const second = connector.sendAndWait('send_msg', {}, 'sendMsgBack_uuid_b', 1000)
        assert.equal(sent[0][0], sseMode === 'true' ? 'http' : 'ws')
        const response = (echo, id) => JSON.stringify({ echo, status: 'ok', data: { message_id: id } })
        connector.onmessage(response(sent[1][3], 102))
        connector.onmessage(response(sent[0][3], 101))
        assert.equal((await first).data.message_id, 101)
        assert.equal((await second).data.message_id, 102)
        assert.equal(dispatched.length, 2)
        assert.equal(connector.pendingSendEchoes.size, 0)
        assert.equal(connector.ReMap.size, 0)
        await assert.rejects(connector.sendAndWait('send_msg', {}, 'timeout', 1))
        assert.equal(connector.pendingSendEchoes.size, 0)
        connector.onmessage(response('send_timeout', 103))
        assert.equal(connector.ReMap.size, 0)
    }
})

test('an image is encoded with a sendable file and a preview without changing the original', async () => {
    const t = await setup()
    const original = [{ type: 'image', file: 'cache.jpg', url: 'https://example.com/image.gif' }]
    const payload = prepareForwardMessage(original)
    t.api.sendMsgRaw('20', 'group', payload, true)
    assert.equal(t.calls[0][1].message[0].data.file, 'https://example.com/image.gif')
    assert.equal(t.chat.messageList[0].message[0].url, 'https://example.com/image.gif')
    assert.equal(original[0].file, 'cache.jpg')
})

test('forwarding snapshots IDs and chronological order without mutating the source', () => {
    const source = [message(3, 'last', { time: 30 }), message('2', 'middle', { time: 20 }), message(1, 'first')]
    const snapshot = snapshotForwardMessages(source, ['3', 1, 2])
    assert.deepEqual(snapshot.map(item => item.message_id), [1, '2', 3])
    source[2].message[0].text = 'changed after opening target'
    assert.equal(snapshot[0].message[0].text, 'first')
    assert.deepEqual(source.map(item => item.message_id), [3, '2', 1])
})

test('same-second messages follow sequence or insertion order, never opaque IDs', async () => {
    const t = await setup()
    const messages = [message(900, 'first'), message(-100, 'second'), message(2, 'third')]
    assert.deepEqual([...messages].sort(t.api.compareMessageOrder), messages)
    assert.deepEqual(snapshotForwardMessages([
        message(900, 'second', { seq_id: 2 }), message(-100, 'first', { seq_id: 1 }),
    ], [900, -100]).map(item => item.raw_message), ['first', 'second'])
})

test('images use transferable file sources and preserve mixed text and flash types', () => {
    const source = [
        { type: 'text', text: 'caption' },
        { type: 'image', file: 'cache-name.jpg', url: 'https://example.com/original.jpg', type_item: 'flash' },
        { type: 'image', data: { file: 'other-cache.jpg', url: 'https://example.com/other.gif' } },
        { type: 'image', file: 'base64://YWJj', url: 'https://example.com/preview.jpg' },
        { type: 'image', url: 'data:image/png;base64,YWJj' },
        { type: 'image', file: 'file:///tmp/image.jpg' },
        { type: 'image', file: 'cached-only.jpg' },
    ]
    const original = structuredClone(source)
    const payload = prepareForwardMessage(source)
    assert.deepEqual(payload.map(item => item.file), [undefined, 'https://example.com/original.jpg',
        'https://example.com/other.gif', 'base64://YWJj', 'base64://YWJj', 'file:///tmp/image.jpg', 'cached-only.jpg'])
    assert.equal(payload[1]._type, 'flash')
    assert.deepEqual(source, original)
    assert.throws(() => prepareForwardMessage([{ type: 'image', url: 'blob:local-only' }]), /transferable/)
})

test('self events update the exact ID, including index zero, preserving other messages', () => {
    const first = message(101, 'pending first', { fake_message_id: 'uuid-1', fake_msg: false })
    const second = message(102, 'pending second', { fake_message_id: 'uuid-2', fake_msg: false })
    const messages = [first, second, message(1, 'history')]
    assert.equal(reconcileSentMessage(messages, message(101, 'delivered first')), true)
    assert.equal(first.message[0].text, 'delivered first')
    assert.equal(second.message[0].text, 'pending second')
    assert.equal(messages.length, 3)
    assert.equal(reconcileSentMessage(messages, message(102, 'other chat', { group_id: 30 })), false)
    assert.equal(reconcileSentMessage(messages, message(999, 'unrelated self event')), false)
})

test('self events before acknowledgements deduplicate only their own sent message', async () => {
    const t = await setup()
    const first = message('uuid-1', 'pending first', { fake_message_id: 'uuid-1', fake_msg: true })
    const second = message('uuid-2', 'pending second', { fake_message_id: 'uuid-2', fake_msg: true })
    t.chat.messageList = [message(1, 'history'), first, second, message(101, 'delivered first')]
    t.api.sendMsgBack('', { status: 'ok', data: { message_id: 101 } }, ['sendMsgBack', 'uuid', 'uuid-1'])
    assert.equal(first.message_id, 101)
    assert.equal(first.message[0].text, 'delivered first')
    assert.deepEqual(t.chat.messageList.map(item => item.message_id), [1, 101, 'uuid-2'])
    assert.equal(t.calls[0][2], 'getSendMsg_101_uuid-1')
})

test('failed sends remove only their placeholder and never request missing data', async () => {
    const t = await setup()
    t.chat.messageList = [message(1, 'history'), message('uuid-1', 'failed', { fake_message_id: 'uuid-1' })]
    t.api.sendMsgBack('', { status: 'failed', retcode: 100, message: 'rejected' }, ['sendMsgBack', 'uuid', 'uuid-1'])
    assert.deepEqual(t.chat.messageList.map(item => item.message_id), [1])
    assert.equal(t.calls.length, 0)
    assert.deepEqual(t.errors, [['error', 'rejected']])
})

test('a delayed body response cannot populate a newly opened chat', async () => {
    let release
    const t = await setup({ getMessageList: () => new Promise(resolve => { release = resolve }) })
    const pending = message(101, 'pending', { fake_message_id: 'uuid-1', fake_msg: false })
    t.chat.messageList = [pending]
    t.api.getSendMsg('', { status: 'ok', data: message(101, 'delivered') }, ['getSendMsg', '101', 'uuid-1'])
    t.chat.messageList = [message(101, 'other chat', { group_id: 30 })]
    release([message(101, 'delivered')])
    await flushForwarding()
    assert.equal(t.chat.messageList[0].message[0].text, 'other chat')
    assert.equal(pending.message[0].text, 'pending')
})

test('individual forwarding waits for each success and holds source and destination across switches', async () => {
    const replies = []
    const sends = []
    const t = await setup({ Connector: {
        send: () => {}, sendAndWait: (...args) => {
            sends.push(args)
            return new Promise(resolve => replies.push(resolve))
        },
    } })
    const source = [message(3, 'third', { time: 30 }), message(1, 'first'), message(2, 'second', { time: 20 })]
    t.runtime.list.push(...source)
    t.runtime.multipleSelectList.value = ['3', '2', '1']
    t.api.forwardMsg({ group_id: 20 })
    const confirm = t.ui.popBoxList[0].button[1].fun
    source[1].message[0].text = 'source changed while confirming'
    const task = confirm()
    await flushForwarding()
    assert.equal(sends.length, 1)
    assert.equal(sends[0][1].message[0].data.text, 'first')
    // A second click must not launch a duplicate batch.
    await confirm()
    assert.equal(sends.length, 1)
    t.runtime.chat.show = { id: 30, type: 'group' }
    t.chat.chatInfo.show = t.runtime.chat.show
    t.chat.messageList = []
    replies.shift()({ status: 'ok', retcode: 0, data: { message_id: 101 } })
    await flushForwarding()
    assert.equal(sends.length, 2)
    assert.equal(t.chat.messageList.length, 0)
    assert.equal(sends[1][1].group_id, '20')
    replies.shift()({ status: 'ok', data: { message_id: 102 } })
    await flushForwarding()
    replies.shift()({ status: 'ok', data: { message_id: 103 } })
    await task
    assert.deepEqual(sends.map(args => args[1].message[0].data.text), ['first', 'second', 'third'])
})

test('individual forwarding stops after rejection and reports partial completion', async () => {
    const replies = [], sends = []
    const t = await setup({ Connector: { sendAndWait: (...args) => {
        sends.push(args)
        return new Promise((resolve, reject) => replies.push({ resolve, reject }))
    } } })
    t.runtime.list.push(message(1, 'first'), message(2, 'second'), message(3, 'third'))
    t.runtime.multipleSelectList.value = ['1', '2', '3']
    t.api.forwardMsg({ user_id: 40 })
    const task = t.ui.popBoxList[0].button[1].fun()
    replies.shift().resolve({ status: 'ok', data: { message_id: 101 } })
    await flushForwarding()
    replies.shift().resolve({ status: 'failed', retcode: 100, wording: 'image rejected' })
    await task
    assert.equal(sends.length, 2)
    assert.equal(sends[0][1].user_id, '40')
    assert.match(t.errors[0][1], /1\/3.*image rejected/)
})

test('search selection forwards the visible search result instead of a colliding timeline ID', async () => {
    const sends = []
    const t = await setup({ Connector: { sendAndWait: async (...args) => {
        sends.push(args)
        return { status: 'ok', data: { message_id: 101 } }
    } } })
    t.runtime.details.value[3].open = true
    t.runtime.list.push(message(1, 'timeline'))
    t.runtime.tags.value.search.list.push(message(1, 'search result'))
    t.runtime.multipleSelectList.value = ['1']
    t.api.forwardMsg({ user_id: 40 })
    await t.ui.popBoxList[0].button[1].fun()
    assert.equal(sends[0][1].message[0].data.text, 'search result')
})

test('wire encoding does not delete the source segment type', async () => {
    const t = await setup()
    const body = [{ type: 'text', text: 'keep me' }]
    t.api.sendMsgRaw('20', 'group', body)
    assert.equal(body[0].type, 'text')
    assert.deepEqual(t.calls[0][1].message, [{ type: 'text', data: { text: 'keep me' } }])
})

test('timeout removes only its own unacknowledged preview', async () => {
    const t = await setup({ Connector: { sendAndWait: async () => { throw new Error('timed out') } } })
    t.chat.messageList = [message(1, 'history')]
    await assert.rejects(t.api.sendMsgRaw('20', 'group', [{ type: 'text', text: 'pending' }], true, 'sendMsgBack', true), /timed out/)
    assert.deepEqual(t.chat.messageList.map(item => item.message_id), [1])
})

test('stale preview requests cannot insert a forward into another visible chat', async () => {
    const t = await setup()
    t.api.sendMsgRaw('30', 'group', [{ type: 'text', text: 'target only' }], true)
    assert.equal(t.chat.messageList.length, 0)
    assert.equal(t.calls[0][1].group_id, '30')
})

test('Lagrange individual sends wait through the existing private action', async () => {
    const sends = []
    const t = await setup({ Connector: { sendAndWait: async (...args) => {
        sends.push(args)
        return { status: 'ok', data: { message_id: 101 } }
    } } })
    t.auth.jsonMap.name = 'Lagrange.OneBot'
    const response = await t.api.sendMsgRaw('40', 'user', [{ type: 'text', text: 'private' }], false, 'sendMsgBack', true)
    assert.equal(response.data.message_id, 101)
    assert.equal(sends[0][0], 'send_private_msg')
    assert.equal(sends[0][1].user_id, '40')
})
