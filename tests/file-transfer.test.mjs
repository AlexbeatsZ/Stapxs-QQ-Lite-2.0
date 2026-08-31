import assert from 'node:assert/strict'
import test from 'node:test'

import {
    getOneBotResponseError,
    uploadFileStream,
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
