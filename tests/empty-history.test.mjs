import assert from 'node:assert/strict'
import test from 'node:test'
import { expandEmptyHistoryPage } from '../src/renderer/src/function/utils/emptyHistory.ts'
import { createEmptyHistoryRuntime } from './helpers/empty-history-runtime.mjs'

const message = (id, empty = false) => ({
    message_id: id, time: id, group_id: 10, post_type: 'message',
    sender: { user_id: 99 }, message: empty ? [] : [{ type: 'text', text: 'message' }],
})
const emptyPage = count => Array.from({ length: count }, (_, i) => message(100 + i, true))
const response = (messages, echo = 'send_getChatHistoryFist') => ({ status: 'ok', retcode: 0, data: { messages }, echo })

test('an all-recalled first window loads older content and retains all server pagination slots', async () => {
    for (const type of ['group', 'user']) {
        const r = await createEmptyHistoryRuntime()
        r.chat.chatInfo.show.type = type
        const empty = emptyPage(20)
        r.runtime.response = response([message(1), ...empty])
        // Connector dispatch removes echo before invoking this production callback.
        const first = response(empty)
        delete first.echo
        await r.api.getInitialHistory('', first)
        assert.equal(r.chat.messageList.length, 21)
        assert.equal(r.chat.messageList[0].message_id, 1)
        assert.equal(r.calls[0][0], type === 'group' ? 'group_history' : 'private_history')
        assert.equal(r.calls[0][1][type === 'group' ? 'group_id' : 'user_id'], 10)
        assert.equal(r.calls[0][1].count, 40)
        await r.api.loadMoreHistory()
        assert.equal(r.calls[1][1].count, 41)
    }
})

test('more than one full empty window advances 20, 40, 60 rather than repeating visible counts', async () => {
    const calls = []
    const result = await expandEmptyHistoryPage(emptyPage(20), async count => {
        calls.push(count)
        return count === 40 ? emptyPage(40) : [message(1), ...emptyPage(59)]
    }, () => true)
    assert.deepEqual(calls, [40, 60])
    assert.equal(result.length, 60)
    assert.equal(result[0].message_id, 1)
})

test('mixed history keeps empty records so repeated manual pages continue increasing the count', async () => {
    const r = await createEmptyHistoryRuntime()
    await r.api.saveMsg(response([message(1), ...emptyPage(20)]))
    await r.api.loadMoreHistory()
    assert.equal(r.calls[0][1].count, 41)
    r.ui.nowGetHistory = false
    await r.api.saveMsg(response([message(0), message(1), ...emptyPage(39)], 'send_getChatHistory'), 'top')
    await r.api.loadMoreHistory()
    assert.equal(r.calls[1][1].count, 61)
})

test('empty history renders the existing unavailable notice for either sender', async () => {
    const r = await createEmptyHistoryRuntime()
    const own = message(1, true)
    const other = { ...message(2, true), sender: { user_id: 42 } }
    assert.equal(r.api.isDeleteMsg(own), true)
    assert.equal(r.api.isDeleteMsg(other), true)
    assert.equal(r.api.isDeleteMsg(message(3)), false)
    assert.equal(r.api.isDeleteMsg({ ...own, post_type: 'notice' }), false)
})

test('fresh empty history removes stale cached bodies without restoring recalled content', async () => {
    const r = await createEmptyHistoryRuntime()
    r.settings.sysConfig.enable_local_history = true
    r.settings.sysConfig.mixed_load_messages = true
    r.chat.messageList.push({ ...message(1), _from_local_db: true })
    await r.api.saveMsg(response([message(1, true)], 'send_getChatHistory'), 'top')
    assert.deepEqual(r.chat.messageList[0].message, [])
    await r.api.saveMsg(response([message(1)], 'send_getChatHistory'), 'top')
    assert.deepEqual(r.chat.messageList[0].message, [])
})

test('incremental adapters and unrelated previews never expand empty windows', async () => {
    const r = await createEmptyHistoryRuntime()
    r.auth.jsonMap.message_list.pagerType = 'incremental'
    await r.api.getInitialHistory('', response(emptyPage(20)))
    assert.equal(r.calls.length, 0)
    r.auth.jsonMap.message_list.pagerType = 'full'
    await r.api.normalizeMessagesFromPayload(response(emptyPage(20), 'send_readMemberMessage'))
    assert.equal(r.calls.length, 0)
})

test('a delayed expansion cannot populate a different chat or a new instance of the same chat', async () => {
    for (const id of [11, 10]) {
        const r = await createEmptyHistoryRuntime()
        let done
        r.runtime.Connector.callRawApi = () => new Promise(resolve => { done = resolve })
        const pending = r.api.getInitialHistory('', response(emptyPage(20)))
        await new Promise(resolve => setImmediate(resolve))
        r.chat.chatInfo.show = { id, type: 'group' }
        r.chat.messageList.push(message(999))
        done(response([message(1), ...emptyPage(20)]))
        await pending
        assert.deepEqual(r.chat.messageList.map(m => m.message_id), [999])
        assert.equal(r.saved.length, 0)
    }
})

test('failed, capped and exhausted expansion retains placeholders for manual retry', async () => {
    for (const next of [{ status: 'failed', retcode: 100, data: null }, response(emptyPage(20)), response([])]) {
        const r = await createEmptyHistoryRuntime()
        r.runtime.response = next
        await r.api.getInitialHistory('', response(emptyPage(20)))
        assert.equal(r.calls.length, 1)
        assert.equal(r.chat.messageList.length, 20)
        assert.equal(r.ui.canLoadHistory, true)
    }
})

test('automatic expansion is bounded and a truly empty response does not request more', async () => {
    let calls = 0
    const result = await expandEmptyHistoryPage(emptyPage(20), async count => {
        calls++
        return emptyPage(count)
    }, () => true)
    assert.equal(calls, 10)
    assert.equal(result.length, 220)
    await expandEmptyHistoryPage([], async () => { throw new Error('Must not fetch') }, () => true)
})
