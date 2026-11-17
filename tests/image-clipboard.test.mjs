import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const chatFile = 'src/renderer/src/pages/Chat.vue'
const viewerFile = 'src/renderer/src/components/ViewerCom.vue'
const systemFile = 'src/renderer/src/function/utils/systemUtil.ts'

function loadFunctions(file, names, runtime) {
    let source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    if (file.endsWith('.vue')) source = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    const declarations = names.map(name => {
        const node = parsed.statements.find(node =>
            ts.isFunctionDeclaration(node) && node.body && node.name?.text === name)
        assert.ok(node, `production function ${name} exists`)
        return node.getText(parsed).replace(/^export /, '')
    }).join('\n')
    const compiled = ts.transpileModule(declarations, {
        compilerOptions: { target: ts.ScriptTarget.ESNext },
    }).outputText.replace('import(\'@tauri-apps/plugin-clipboard-manager\')', 'loadClipboard()')
    return new Function(...Object.keys(runtime),
        `let imageClipboardGeneration = 0;\n${compiled}\nreturn { ${names.join(', ')} }`)(
        ...Object.values(runtime))
}

function deferred() {
    let resolve
    let reject
    const promise = new Promise((accept, fail) => { resolve = accept; reject = fail })
    return { promise, resolve, reject }
}

function clipboardRuntime({ type = 'web', write, loadClipboard } = {}) {
    const writes = []
    class ClipboardItem {
        constructor(data) { this.data = data }
    }
    const runtime = {
        backend: { type },
        window: {
            ClipboardItem,
            navigator: { clipboard: { write: write ?? (async items => {
                const blob = await items[0].data['image/png']
                writes.push(blob)
            }) } },
        },
        i18n: { global: { t: text => text } },
        loadClipboard: loadClipboard ?? (async () => ({ writeImage: async bytes => writes.push(bytes) })),
    }
    return {
        ...loadFunctions(systemFile, ['copyToClipboard', 'copyImageToClipboard'], runtime),
        runtime,
        writes,
    }
}

const png = new Blob(['PNG fixture'], { type: 'image/png' })

test('starts the browser PNG write before waiting for image loading', async () => {
    const image = deferred()
    let writeStarted = false
    let loadingStarted = false
    const { copyImageToClipboard } = clipboardRuntime({ write: async items => {
        writeStarted = true
        assert.equal(loadingStarted, false)
        assert.deepEqual(Object.keys(items[0].data), ['image/png'])
        assert.ok(items[0].data['image/png'] instanceof Promise)
        assert.equal(await items[0].data['image/png'], png)
    } })
    const result = copyImageToClipboard(() => { loadingStarted = true; return image.promise })
    assert.equal(writeStarted, true)
    image.resolve(png)
    await result
})

for (const failure of [new Error('image load failed'), new DOMException('CORS', 'SecurityError')]) {
    test(`propagates ${failure.message} without writing text`, async () => {
        const { copyImageToClipboard, writes } = clipboardRuntime()
        await assert.rejects(copyImageToClipboard(() => Promise.reject(failure)), failure)
        assert.deepEqual(writes, [])
    })
}

test('rejects empty conversion results', async () => {
    const { copyImageToClipboard, writes } = clipboardRuntime()
    await assert.rejects(copyImageToClipboard(async () => undefined), /图片转换失败/)
    assert.deepEqual(writes, [])
})

test('reports denied browser writes', async () => {
    const denied = new DOMException('permission denied', 'NotAllowedError')
    const { copyImageToClipboard } = clipboardRuntime({ write: async () => { throw denied } })
    await assert.rejects(copyImageToClipboard(async () => png), denied)
})

for (const missing of ['ClipboardItem', 'clipboard', 'write']) {
    test(`reports missing ${missing} before loading an image`, async () => {
        const { copyImageToClipboard, runtime } = clipboardRuntime()
        if (missing === 'ClipboardItem') delete runtime.window.ClipboardItem
        if (missing === 'clipboard') delete runtime.window.navigator.clipboard
        if (missing === 'write') delete runtime.window.navigator.clipboard.write
        await assert.rejects(copyImageToClipboard(() => assert.fail('image loading must wait for support')),
            /当前环境不支持剪贴板操作/)
    })
}

test('a slow older browser image cannot overwrite a newer copy', async () => {
    const old = deferred()
    const { copyImageToClipboard, writes } = clipboardRuntime()
    const first = copyImageToClipboard(() => old.promise)
    const firstRejected = assert.rejects(first, { name: 'AbortError' })
    await copyImageToClipboard(async () => png)
    old.resolve(new Blob(['old'], { type: 'image/png' }))
    await firstRejected
    assert.deepEqual(writes, [png])
})

test('Tauri writes PNG bytes through its native clipboard', async () => {
    const { copyImageToClipboard, writes, runtime } = clipboardRuntime({ type: 'tauri' })
    delete runtime.window.ClipboardItem
    delete runtime.window.navigator.clipboard
    await copyImageToClipboard(async () => png)
    assert.deepEqual(writes, [new Uint8Array(await png.arrayBuffer())])
})

test('a slow older Tauri image cannot overwrite a newer copy', async () => {
    const old = deferred()
    const { copyImageToClipboard, writes } = clipboardRuntime({ type: 'tauri' })
    const first = copyImageToClipboard(() => old.promise)
    const firstRejected = assert.rejects(first, { name: 'AbortError' })
    await copyImageToClipboard(async () => png)
    old.resolve(png)
    await firstRejected
    assert.equal(writes.length, 1)
})

test('Tauri rechecks request ownership after loading its clipboard plugin', async () => {
    const plugin = deferred()
    const writes = []
    const native = { writeImage: async bytes => writes.push(bytes) }
    let loads = 0
    const { copyImageToClipboard } = clipboardRuntime({
        type: 'tauri',
        loadClipboard: () => ++loads === 1 ? plugin.promise : Promise.resolve(native),
    })
    const first = copyImageToClipboard(async () => png)
    const firstRejected = assert.rejects(first, { name: 'AbortError' })
    await Promise.resolve()
    await copyImageToClipboard(async () => png)
    plugin.resolve(native)
    await firstRejected
    assert.equal(writes.length, 1)
})

function menuRuntime() {
    const tags = { value: { menuDisplay: { copy: true, copyImg: false, downloadImg: false } } }
    const menu = { style: {}, clientWidth: 200 }
    const runtime = {
        tags,
        selectedMsg: { value: null },
        Option: { get: () => 'info' },
        multipleSelectList: { value: [] },
        document: { getElementById: () => menu, getSelection: () => null },
        chatStore: { chatInfo: { show: { type: 'private' }, info: { me_info: { role: 'member' } } } },
        authStore: { loginInfo: { uin: 123 } },
        get: () => false,
        details: { value: [{}, {}, {}, { open: false }] },
        window: { innerWidth: 1200 },
        setTimeout: () => undefined,
        backend: { isDesktop: () => false },
    }
    return { ...loadFunctions(chatFile, ['showMsgMeun'], runtime), tags }
}

test('the web image menu selects image copying for CQ-backed messages', () => {
    const { showMsgMeun, tags } = menuRuntime()
    const src = 'https://multimedia.nt.qq.com.cn/download?appid=1407&fileid=fixture&spec=0'
    showMsgMeun({ target: { nodeName: 'IMG', src }, x: 100, y: 100 }, {
        message_id: 'opaque-id', sender: { user_id: 456 },
        message: [{ type: 'image', data: { file: 'fixture.png', url: src } }],
        raw_message: '[CQ:image,file=fixture.png,url=https\\://multimedia.nt.qq.com.cn/download?appid=1407&amp;fileid=fixture]',
    })
    assert.equal(tags.value.menuDisplay.copy, false)
    assert.equal(tags.value.menuDisplay.copyImg, true)
    assert.equal(tags.value.menuDisplay.downloadImg, src)
})

test('text messages keep their normal text copy menu', () => {
    const { showMsgMeun, tags } = menuRuntime()
    showMsgMeun({ target: { nodeName: 'SPAN' }, x: 100, y: 100 }, {
        message_id: 'text-id', sender: { user_id: 456 },
        message: [{ type: 'text', data: { text: 'hello' } }], raw_message: 'hello',
    })
    assert.equal(tags.value.menuDisplay.copy, true)
    assert.equal(tags.value.menuDisplay.copyImg, false)
})

function entryRuntime(copyImageToClipboard) {
    const notices = []
    const errors = []
    return {
        notices,
        errors,
        copyImageToClipboard,
        PopInfo: class { add(type, text) { notices.push({ type, text }) } },
        PopType: { INFO: 'success', ERR: 'error' },
        Logger: class { error(error) { errors.push(error) } },
        $t: text => text,
    }
}

test('chat copy captures the selected image before closing the menu', async () => {
    const { copyImageToClipboard, writes } = clipboardRuntime()
    const runtime = entryRuntime(copyImageToClipboard)
    runtime.tags = { value: { menuDisplay: { downloadImg: 'https://example.com/image.png' } } }
    runtime.closeMsgMenu = () => { runtime.tags.value.menuDisplay.downloadImg = false }
    runtime.getImageUrlData = async url => {
        assert.equal(url, 'https://example.com/image.png')
        return { blob: png }
    }
    const { copyImg } = loadFunctions(chatFile, ['copyImg'], runtime)
    await copyImg()
    assert.deepEqual(writes, [png])
    assert.deepEqual(runtime.notices, [{ type: 'success', text: '复制成功' }])
})

test('chat image failures produce an error notice', async () => {
    const { copyImageToClipboard, writes } = clipboardRuntime()
    const runtime = entryRuntime(copyImageToClipboard)
    runtime.tags = { value: { menuDisplay: { downloadImg: 'https://example.com/expired.png' } } }
    runtime.closeMsgMenu = () => undefined
    runtime.getImageUrlData = async () => { throw new Error('expired image') }
    await loadFunctions(chatFile, ['copyImg'], runtime).copyImg()
    assert.deepEqual(writes, [])
    assert.deepEqual(runtime.notices, [{ type: 'error', text: '复制失败' }])
    assert.equal(runtime.errors[0].message, 'expired image')
})

for (const entry of ['copy', 'editCopy']) {
    test(`viewer ${entry} uses the shared PNG clipboard entry`, async () => {
        const { copyImageToClipboard, writes } = clipboardRuntime()
        const runtime = entryRuntime(copyImageToClipboard)
        runtime.getBlob = async () => png
        const methods = loadFunctions(viewerFile, ['copy', 'editCopy'], runtime)
        await methods[entry]()
        assert.deepEqual(writes, [png])
        assert.deepEqual(runtime.notices, [{ type: 'success', text: '复制成功' }])
    })
}

test('viewer conversion errors produce an error notice', async () => {
    const { copyImageToClipboard, writes } = clipboardRuntime()
    const runtime = entryRuntime(copyImageToClipboard)
    runtime.getBlob = async () => { throw new Error('canvas failed') }
    await loadFunctions(viewerFile, ['copy'], runtime).copy()
    assert.deepEqual(writes, [])
    assert.deepEqual(runtime.notices, [{ type: 'error', text: '复制失败' }])
})
