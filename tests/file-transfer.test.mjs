import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

import {
    getOneBotResponseError,
    isActiveTransferStatus,
    uploadFileStream,
    withDownloadFileName,
} from '../src/renderer/src/function/utils/fileTransferUtil.ts'

const options = {
    action: 'upload_file_stream',
    streamId: 'stream-1',
    fileName: 'sample.bin',
    chunkSize: 4,
    fileRetentionMs: 60_000,
    chunkTimeoutMs: 1_000,
    completeTimeoutMs: 2_000,
}

test('keeps every in-progress transfer state visible', () => {
    for (const status of ['pending', 'downloading', 'uploading', 'finalizing']) {
        assert.equal(isActiveTransferStatus(status), true)
    }
    for (const status of ['completed', 'delegated', 'failed', 'cancelled']) {
        assert.equal(isActiveTransferStatus(status), false)
    }
})

test('fills the empty QQ fname parameter for browser-managed downloads', () => {
    const qq = new URL('https://njc-download.ftn.qq.com/ftn_handler/abc/?fname=')
    const named = withDownloadFileName(qq, '回家 a+b (1)&x=%$&.html')
    assert.equal(named.searchParams.get('fname'), '回家 a+b (1)&x=%$&.html')
    // QQ 文件服务器不会把 + 还原为空格；文件名里的 + 必须编码为 %2B
    assert.equal(named.search.includes('+'), false)
    assert.equal(
        withDownloadFileName(qq, 'c++ notes+1.txt').search,
        '?fname=c%2B%2B%20notes%2B1.txt',
    )
    // 只替换 fname，其他参数不能被重新序列化（%20 不能变成 +）
    assert.equal(
        withDownloadFileName(
            new URL('https://n.ftn.qq.com/ftn_handler/a/?k=a%20b%2Bc+d&fname='),
            'x+y',
        ).search,
        '?k=a%20b%2Bc+d&fname=x%2By',
    )
    assert.equal(
        withDownloadFileName(new URL('https://n.ftn.qq.com/ftn_handler/a/?x=1&fname=&y=2'), 'a b').search,
        '?x=1&y=2&fname=a%20b',
    )
    assert.equal(qq.searchParams.get('fname'), '')

    const preset = new URL('https://njc-download.ftn.qq.com/ftn_handler/abc/?fname=a.txt')
    assert.equal(withDownloadFileName(preset, 'b.txt').searchParams.get('fname'), 'b.txt')
    for (const href of [
        'https://example.com/file?id=1',
        'https://example.com/ftn_handler/x/?fname=',
        'https://evil.ftn.qq.com.example.com/ftn_handler/x/?fname=',
        'https://njc-download.ftn.qq.com/other/?fname=',
        'https://ftn.qq.com.example.com/ftn_handler/x/?fname=',
        'ftp://njc-download.ftn.qq.com/ftn_handler/x/?fname=',
    ]) {
        const other = new URL(href)
        assert.equal(withDownloadFileName(other, 'b.txt').href, other.href)
    }
})

const downloadNames = [
    '中文课题研究_小组组会 (1).pptx',
    'c++ notes+1.txt',
    'a%20 &fname=other#?=$.zip',
    '报告🧪 e\u0301.tar.gz',
    '.hidden',
    'README',
    '课题'.repeat(40) + '.pdf',
]

for (const query of [
    '',
    '?fname=',
    '?fname',
    '?fname=/11111111-2222-4333-8444-555555555555',
    '?fname=%2Ftmp%2Fcache-file',
    '?fname=wrong.bin',
    '?fname=wrong&fname=&f%6eame=another',
    '?token=a%20b%2Bc+d&fname=wrong&empty=&flag&fname2=keep#fragment',
]) {
    test(`uses the original filename for QQ query ${query || '(missing query)'}`, () => {
        const url = new URL(`https://GZC-DOWNLOAD.ftn.qq.com/ftn_handler/file/${query}`)
        for (const name of downloadNames) {
            const result = withDownloadFileName(url, name)
            assert.deepEqual(result.searchParams.getAll('fname'), [name])
            assert.equal(result.search.includes('+'), query.includes('+'))
            assert.equal(result.hash, url.hash)
            assert.equal(withDownloadFileName(result, name).href, result.href)
            if (query.includes('token=')) {
                assert.equal(result.search, `?token=a%20b%2Bc+d&empty=&flag&fname2=keep&fname=${encodeURIComponent(name)}`)
            }
        }
        assert.equal(url.href, new URL(`https://GZC-DOWNLOAD.ftn.qq.com/ftn_handler/file/${query}`).href)
        assert.equal(withDownloadFileName(url, '').href, url.href)
    })
}

function loadProductionFunction(file, name, runtime) {
    let source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    if (file.endsWith('.vue')) source = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
    assert.ok(declaration, `Missing production function ${name}`)
    const code = ts.transpileModule(declaration.getText(parsed).replace(/^export\s+/, ''), {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText
    return new Function(...Object.keys(runtime), `${code}\nreturn ${name}`)(...Object.values(runtime))
}

test('chat, private and group-file entry points retain filenames through the browser download handoff', () => {
    for (const backendType of ['web', 'capacitor']) {
        const links = []
        const document = {
            location: new URL('https://qq.example.test/'),
            createElement: () => ({ style: {}, click() { links.push(this) }, remove() { return undefined } }),
            body: { appendChild() { return undefined } },
        }
        const download = loadProductionFunction('src/renderer/src/function/utils/appUtil.ts', 'downloadFile', {
            document, backend: { type: backendType, isWeb: () => backendType === 'web' },
            withDownloadFileName, setTimeout: callback => callback(),
        })
        const callback = loadProductionFunction('src/renderer/src/function/msg.ts', 'startFileDownload', {
            getMsgData: (_key, response) => [response.data], msgPath: { file_download: {} },
            addDownloadTask: task => download(task.url, task.fileName, () => {}, () => {}),
        })
        const Connector = {
            send: (action, _params, echo) => callback(action, {
                data: { file_url: 'https://gzc-download.ftn.qq.com/ftn_handler/file/?fname=/cache-uuid' },
            }, echo.split('_')),
        }
        const runtime = {
            Connector, authStore: { jsonMap: { file_download: { name: 'group', private_name: 'private' } } },
            chatStore: { chatInfo: { show: { type: 'group', id: 1 } } },
        }
        const chatDownload = loadProductionFunction('src/renderer/src/components/MsgBody.vue', 'downloadFile', runtime)
        const groupDownload = loadProductionFunction('src/renderer/src/components/FileBody.vue', 'getFile', runtime)
        for (const name of downloadNames) {
            chatDownload({ file_id: 'file-id', name }, 'message-id')
            runtime.chatStore.chatInfo.show.type = 'private'
            chatDownload({ file_id: 'file-id', file_name: name }, 'message-id')
            runtime.chatStore.chatInfo.show.type = 'group'
            groupDownload({ file_id: 'file-id', file_name: name })
            assert.equal(links.length, 3)
            for (const link of links.splice(0)) {
                assert.equal(new URL(link.href).searchParams.get('fname'), name)
                assert.equal(link.download, name)
            }
        }
    }
})

test('same-origin and blob downloads supply the original filename to the buffered downloader', async () => {
    const configs = []
    const download = loadProductionFunction('src/renderer/src/function/utils/appUtil.ts', 'downloadFile', {
        document: { location: new URL('https://qq.example.test/') },
        backend: { isWeb: () => true }, withDownloadFileName,
        FileDownloader: class {
            constructor(config) { configs.push(config) }
            start() { return Promise.resolve() }
        },
    })
    for (const url of ['/local-file', 'blob:https://qq.example.test/file-id']) {
        download(url, downloadNames[0], () => {}, () => {})
        assert.equal(configs.at(-1).nameCallback(), downloadNames[0])
    }
    await new Promise(resolve => setImmediate(resolve))
})

test('Electron and Tauri downloads pass the original filename and task identity to the native backend', async () => {
    for (const type of ['electron', 'tauri']) {
        const calls = []
        const download = loadProductionFunction('src/renderer/src/function/utils/appUtil.ts', 'downloadFile', {
            document: { location: new URL('https://qq.example.test/') },
            backend: {
                type, isWeb: () => false,
                addListener: () => ({ ready: Promise.resolve(true), remove() { return undefined } }),
                call: (...args) => { calls.push(args) },
            },
        })
        download('https://gzc-download.ftn.qq.com/ftn_handler/file/?fname=/cache-uuid',
            downloadNames[0], () => {}, () => {}, undefined, undefined, 'download-task')
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(calls.length, 1)
        assert.equal(calls[0][3].fileName, downloadNames[0])
        assert.equal(calls[0][3].taskId, 'download-task')
    }
})

test('uploads a blob as ordered bounded chunks', async () => {
    const chunks = []
    const progress = []
    const file = new Blob([Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])])

    const filePath = await uploadFileStream(
        file,
        options,
        async (action, params) => {
            assert.equal(action, 'upload_file_stream')
            if (params.is_complete) {
                return { status: 'ok', retcode: 0, data: { file_path: 'C:/temp/sample.bin' } }
            }
            chunks.push(Buffer.from(params.chunk_data, 'base64'))
            return { status: 'ok', retcode: 0, data: { status: 'chunk_received' } }
        },
        (loaded, total) => progress.push([loaded, total]),
    )

    assert.equal(filePath, 'C:/temp/sample.bin')
    assert.deepEqual(chunks.map((chunk) => chunk.length), [4, 4, 2])
    assert.deepEqual(Buffer.concat(chunks), Buffer.from(await file.arrayBuffer()))
    assert.deepEqual(progress, [[4, 10], [8, 10], [10, 10]])
})

test('resets the server stream after a failed chunk', async () => {
    const calls = []
    await assert.rejects(
        uploadFileStream(
            new Blob(['failure']),
            options,
            async (_, params) => {
                calls.push(params)
                if (params.reset) return { status: 'failed', retcode: 1 }
                return { status: 'failed', retcode: 1404, message: 'unsupported action' }
            },
            () => undefined,
        ),
        /unsupported action/,
    )
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls.at(-1).reset, true)
})

test('extracts useful OneBot errors', () => {
    assert.equal(getOneBotResponseError({ status: 'ok', retcode: 0 }), undefined)
    assert.equal(
        getOneBotResponseError({ status: 'failed', retcode: 100, wording: 'upload failed' }),
        'upload failed',
    )
})

test('rejects invalid chunk sizes before starting a stream', async () => {
    let called = false
    await assert.rejects(
        uploadFileStream(
            new Blob(['data']),
            { ...options, chunkSize: 0 },
            async () => {
                called = true
                return { status: 'ok', retcode: 0 }
            },
            () => undefined,
        ),
        /greater than zero/,
    )
    assert.equal(called, false)
})

test('stops before sending the next chunk after cancellation', async () => {
    const controller = new AbortController()
    const calls = []
    await assert.rejects(
        uploadFileStream(
            new Blob(['abcdefgh']),
            options,
            async (_, params) => {
                calls.push(params)
                if (params.chunk_index === 0) controller.abort()
                return { status: 'ok', retcode: 0 }
            },
            () => undefined,
            controller.signal,
        ),
        { name: 'AbortError' },
    )
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(calls.map((params) => params.chunk_index), [0, undefined])
    assert.equal(calls.at(-1).reset, true)
})

test('rejects cancellation while waiting for stream completion', async () => {
    const controller = new AbortController()
    const calls = []
    let finishCompletion
    const completion = new Promise((resolve) => {
        finishCompletion = resolve
    })
    const upload = uploadFileStream(
        new Blob(['data']),
        options,
        async (_, params) => {
            calls.push(params)
            if (params.is_complete) return completion
            if (params.reset) return { status: 'ok', retcode: 0 }
            return { status: 'ok', retcode: 0 }
        },
        () => undefined,
        controller.signal,
    )

    await new Promise((resolve) => setImmediate(resolve))
    controller.abort()
    finishCompletion({
        status: 'ok',
        retcode: 0,
        data: { file_path: 'C:/temp/sample.bin' },
    })

    await assert.rejects(upload, { name: 'AbortError' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls.at(-1).reset, true)
})
