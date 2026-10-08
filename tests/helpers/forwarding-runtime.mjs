import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function sourceFile(file) {
    let source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
    if (file.endsWith('.vue')) source = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
    return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function functionSource(file, name) {
    const source = sourceFile(file)
    const node = source.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name)
    assert.ok(node, `Missing production function ${name}`)
    return node.getText(source).replace(/^export\s+/, '')
}

function callbackSource(name) {
    const source = sourceFile('src/renderer/src/function/msg.ts')
    let body
    function visit(node) {
        if (ts.isPropertyAssignment(node) && node.name.getText(source) === name) {
            body = node.initializer.getText(source)
        }
        ts.forEachChild(node, visit)
    }
    visit(source)
    assert.ok(body, `Missing production callback ${name}`)
    return `const ${name} = ${body}`
}

export async function loadForwardingRuntime(runtime) {
    const chatFile = 'src/renderer/src/pages/Chat.vue'
    const names = ['cloneMessagePayload', 'forwardMsg']
    const code = `export default runtime => {
        let qed_try_times = 0
        ${Object.keys(runtime).map(name => `const ${name} = runtime.${name}`).join('\n')}
        ${names.map(name => functionSource(chatFile, name)).join('\n')}
        ${functionSource('src/renderer/src/function/utils/msgUtil.ts', 'sendMsgRaw')}
        ${functionSource('src/renderer/src/function/utils/msgUtil.ts', 'lgrSendMsg')}
        ${functionSource('src/renderer/src/function/msg.ts', 'newMsg')}
        ${functionSource('src/renderer/src/function/msg.ts', 'getMessageTimestamp')}
        ${functionSource('src/renderer/src/function/msg.ts', 'compareMessageOrder')}
        ${callbackSource('sendMsgBack')}
        ${callbackSource('getSendMsg')}
        return { forwardMsg, sendMsgRaw, sendMsgBack, getSendMsg, newMsg, compareMessageOrder }
    }`
    const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '\n//# sourceURL=forwarding-runtime.mjs'
    return (await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)).default(runtime)
}

export const flushForwarding = () => new Promise(resolve => setImmediate(resolve))

export async function loadForwardingConnector(runtime) {
    const source = sourceFile('src/renderer/src/function/connect.ts')
    const connector = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'Connector')
    const members = connector.members.filter(node =>
        ['ReMap', 'pendingSendEchoes', 'onmessage', 'waitReturn', 'send', 'sendAndWait'].includes(node.name?.getText(source)))
    const code = `export default runtime => {
        const { logger, dispatch, sseMode, TimeoutError } = runtime
        const LogType = { WS: 'ws' }
        class Connector { ${members.map(node => node.getText(source)).join('\n')} }
        return Connector
    }`.replaceAll('import.meta.env.VITE_APP_SSE_MODE', 'sseMode')
    const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '\n//# sourceURL=forwarding-connector.mjs'
    return (await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)).default(runtime)
}

export function message(id, text, extra = {}) {
    return {
        message_id: id, time: 10, group_id: 20, message_type: 'group', post_type: 'message',
        sender: { user_id: 99, nickname: 'self' }, message: [{ type: 'text', text }],
        raw_message: text, ...extra,
    }
}
