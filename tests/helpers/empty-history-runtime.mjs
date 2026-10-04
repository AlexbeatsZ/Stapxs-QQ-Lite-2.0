import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as history from '../../src/renderer/src/function/utils/historyRequest.ts'
import { expandEmptyHistoryPage, isEmptyHistoryPage } from '../../src/renderer/src/function/utils/emptyHistory.ts'

// Run the production normalizer, application and paging functions with controlled I/O.
function functionSource(file, name) {
    let text = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
    if (file.endsWith('.vue')) text = text.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const node = source.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name)
    assert.ok(node, `Missing production function ${name}`)
    return node.getText(source).replace(/^export\s+/, '')
}

function initialCallbackSource(file) {
    const text = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    let callback
    function visit(node) {
        if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'getChatHistoryFist') {
            callback = node.initializer.getText(source)
        }
        ts.forEachChild(node, visit)
    }
    visit(source)
    assert.ok(callback, 'Missing initial history callback')
    return `const initialCallback = ${callback}
        const getInitialHistory = (name, payload) => initialCallback(name, payload,
            ['getChatHistoryFist', String(historyRequestTracker.begin(useChatStore().chatInfo.show).generation)])`
}

export async function createEmptyHistoryRuntime() {
    const chat = { chatInfo: { show: { id: 10, type: 'group' } }, messageList: [] }
    const ui = { nowGetHistory: false, canLoadHistory: true, loadHistoryFail: false }
    const auth = { loginInfo: { uin: 99 }, jsonMap: { message_list: {
        name: 'group_history', private_name: 'private_history', pagerType: 'full',
    } } }
    const settings = { sysConfig: { enable_local_history: false, mixed_load_messages: false } }
    const calls = [], saved = [], errors = []
    const runtime = {
        ...history,
        historyRequestTracker: history.createHistoryRequestTracker(),
        uiStore: ui, chatStore: chat, authStore: auth, settingsStore: settings,
        list: new Proxy([], { get: (_target, key) => {
            const value = chat.messageList[key]
            return typeof value === 'function' ? value.bind(chat.messageList) : value
        } }),
        useUIStore: () => ui, useChatStore: () => chat, useAuthStore: () => auth,
        useSettingsStore: () => settings, useContactStore: () => ({ userList: [], baseOnMsgList: new Map() }),
        Connector: { send: (...args) => calls.push(args), callRawApi: async (...args) => {
            calls.push(args)
            return runtime.response
        } },
        logger: { error: (...args) => errors.push(args) },
        getMsgData: (key, payload) => key === 'message_list' ? payload.data.messages : undefined,
        msgPath: { message_list: {}, message_info: {} },
        parseMsgList: list => list,
        saveMessagesWithSideEffects: async (_account, messages) => saved.push(messages),
        formatMessageData: message => message,
        sendMsgAppendInfo: () => {}, updateBaseOnMsgList: () => {},
        dbGetBefore: async () => [], dbGetBeforeByTime: async () => [],
        expandEmptyHistoryPage, isEmptyHistoryPage,
    }
    const msgFile = 'src/renderer/src/function/msg.ts'
    const bodies = [
        initialCallbackSource(msgFile),
        ...['normalizeMessagesFromPayload', 'getMessageList', 'msgPreprocess', 'saveMsg',
            'isCurrentMessageSession', 'isMessageListForCurrentSession', 'applyHistoryMessageList',
            'updateHistorySessionPreview', 'persistMessageHistory', 'handleChatHistoryResponse',
            'reportChatHistoryFailure',
            'mergeMessagesByIdAndTime', 'replaceMessageListInPlace', 'normalizeMessageId',
            'getMessageTimestamp', 'buildFallbackMessageKey', 'compareMessageOrder',
            'getImageSegments', 'hasImageMessage', 'hasResolvableImageSource',
            'shouldReplaceDuplicateMessage'].map(name => functionSource(msgFile, name)),
        functionSource('src/renderer/src/function/utils/msgUtil.ts', 'isDeleteMsg'),
        functionSource('src/renderer/src/function/utils/appUtil.ts', 'loadMoreHistoryMessages'),
        functionSource('src/renderer/src/function/utils/appUtil.ts', 'loadHistoryMessage'),
        functionSource('src/renderer/src/pages/Chat.vue', 'loadMoreHistory'),
        functionSource('src/renderer/src/pages/Chat.vue', 'detectSeqGaps'),
        functionSource('src/renderer/src/pages/Chat.vue', 'fillSeqGaps'),
    ]
    const code = `export default runtime => {
        ${Object.keys(runtime).map(name => typeof runtime[name] === 'function' ?`const ${name} = (...args) => runtime.${name}(...args)` : `const ${name} = runtime.${name}`).join('\n')}
        ${bodies.join('\n')}
        return { saveMsg, getInitialHistory, loadMoreHistory, isDeleteMsg, normalizeMessagesFromPayload }
    }`
    const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    runtime.historyRequestTracker.begin(chat.chatInfo.show)
    const api = (await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)).default(runtime)
    return { api, runtime, chat, ui, auth, settings, calls, saved, errors }
}
