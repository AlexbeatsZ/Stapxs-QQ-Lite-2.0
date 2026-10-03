import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

import * as history from '../../src/renderer/src/function/utils/historyRequest.ts'

// Run production function bodies with controlled stores, I/O and scheduling.
// TypeScript is already a project dependency; browser startup is not needed.
function parseSource(file) {
    let source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
    if (file.endsWith('.vue')) {
        source = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
    }
    return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function functionSource(file, name) {
    const source = parseSource(file)
    const node = source.statements.find(item =>
        ts.isFunctionDeclaration(item) && item.name?.text === name,
    )
    return node?.getText(source).replace(/^export\s+/, '')
}

function callbackSource(file, objectName, propertyName) {
    const source = parseSource(file)
    let callback
    const visit = node => {
        if (ts.isPropertyAssignment(node) && node.name.getText(source) === objectName) {
            callback = node.initializer.properties?.find(property =>
                property.name?.getText(source) === propertyName,
            )?.initializer
        }
        ts.forEachChild(node, visit)
    }
    visit(source)
    assert.ok(callback, `${objectName}.${propertyName} must exist`)
    return callback.getText(source)
}

function gapFillSource() {
    const source = parseSource('src/renderer/src/function/msg.ts')
    let callback
    const visit = node => {
        if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'getChatHistoryGapFill') {
            callback = node.initializer
        }
        ts.forEachChild(node, visit)
    }
    visit(source)
    assert.ok(callback)
    return callback.getText(source)
}

export function createHistoryRuntime() {
    const chat = { chatInfo: { show: { id: 10001, type: 'group' } }, messageList: [] }
    const ui = { nowGetHistory: false, canLoadHistory: true, loadHistoryFail: false, historyBeforeTime: undefined }
    const settings = { sysConfig: { enable_local_history: false, mixed_load_messages: true } }
    const auth = { loginInfo: { uin: 1 }, jsonMap: { message_list: { name: 'group_history', private_name: 'private_history' } } }
    const contacts = { userList: [], baseOnMsgList: new Map() }
    const tracker = history.createHistoryRequestTracker()
    const notifications = []
    const sent = []
    const saved = []
    const ticks = []
    const timers = []
    const pan = { scrollHeight: 100, style: {}, scrollTop: 0 }
    const runtime = {
        ...history,
        historyRequestTracker: tracker,
        useChatStore: () => chat,
        useUIStore: () => ui,
        useSettingsStore: () => settings,
        useAuthStore: () => auth,
        useContactStore: () => contacts,
        chatStore: chat,
        uiStore: ui,
        settingsStore: settings,
        authStore: auth,
        PopInfo: class { add(...args) { notifications.push(args) } },
        PopType: { ERR: 'error' },
        app: { config: { globalProperties: { $t: value => value } } },
        Connector: { send: (...args) => sent.push(args) },
        dbGetLatest: async () => [],
        dbGetBefore: async () => [],
        dbGetBeforeByTime: async () => [],
        normalizeMessagesFromPayload: async payload => payload.messages,
        getMsgData: (name, payload) => name === 'message_list' ? payload.messages : payload?.infoList,
        getMessageList: async list => list,
        msgPath: { message_info: {}, message_list: {} },
        saveMessagesWithSideEffects: (_selfId, list) => saved.push(list),
        mergeMessagesByIdAndTime: (current, incoming) => [...current, ...incoming],
        replaceMessageListInPlace: list => { chat.messageList = list },
        insertHistorySegmentAtAnchor: (current, _anchor, incoming) => [...incoming, ...current],
        sendMsgAppendInfo: () => {},
        formatMessageData: message => message,
        updateBaseOnMsgList: () => {},
        document: { getElementById: () => pan },
        nextTick: callback => { ticks.push(callback) },
        setTimeout: callback => { timers.push(callback) },
        logger: { debug: () => {} },
        opt: { value: { loop: true } },
        props: { get list() { return chat.messageList } },
        getMsgRawTxt: message => message.message_id,
        danmus: { value: [] },
        danmakuRef: { value: undefined },
    }
    Object.defineProperty(runtime, 'list', { get: () => chat.messageList })
    const functions = [
        ['src/renderer/src/function/utils/appUtil.ts', 'loadHistory'],
        ['src/renderer/src/function/utils/appUtil.ts', 'loadHistoryMessage'],
        ['src/renderer/src/function/utils/appUtil.ts', 'loadMoreHistoryMessages'],
        ['src/renderer/src/function/msg.ts', 'isCurrentMessageSession'],
        ['src/renderer/src/function/msg.ts', 'isMessageListForCurrentSession'],
        ['src/renderer/src/function/msg.ts', 'applyHistoryMessageList'],
        ['src/renderer/src/function/msg.ts', 'updateHistorySessionPreview'],
        ['src/renderer/src/function/msg.ts', 'saveMsg'],
        ['src/renderer/src/function/msg.ts', 'handleChatHistoryResponse'],
        ['src/renderer/src/pages/Chat.vue', 'loadMoreHistory'],
        ['src/renderer/src/pages/Chat.vue', 'detectSeqGaps'],
        ['src/renderer/src/pages/Chat.vue', 'fillSeqGaps'],
    ]
    const available = functions.map(([file, name]) => {
        const source = functionSource(file, name)
        assert.ok(source, `${name} must exist`)
        return { name, source }
    })
    const code = [
        ...available.map(item => item.source),
        `globalThis.api = { ${available.map(item => item.name).join(', ')} }`,
        `api.gapFill = ${gapFillSource()}`,
        functionSource('src/renderer/src/pages/chat-view/Chat弹幕.vue', 'updateList'),
        'api.updateDanmakuList = updateList',
        `api.terminalCommand = ${callbackSource('src/renderer/src/pages/chat-view/Chat终端.vue', 'ssqq', 'fun')}`,
    ].join('\n')
    const context = vm.createContext(runtime)
    vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
    return { chat, ui, settings, auth, contacts, tracker, notifications, sent, saved, ticks, timers, pan, runtime, api: context.api }
}

export const flushHistoryCallbacks = () => new Promise(resolve => setImmediate(resolve))

export function historyMessage(id, time = 1) {
    return { message_id: id, message: [{ type: 'text', text: id }], time, sender: { user_id: 1 } }
}
