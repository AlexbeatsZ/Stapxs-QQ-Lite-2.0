import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveForwardImages, isLoadableImageSource } from '../src/renderer/src/function/utils/forwardImage.ts'
import { prepareForwardMessage } from '../src/renderer/src/function/utils/forwardMessage.ts'

const httpUrl = 'https://multimedia.nt.qq.com.cn/download?appid=1407&fileid=abc&rkey=k'

function recorder(result) {
    const calls = []
    const lookup = async (file) => {
        calls.push(file)
        return typeof result === 'function' ? result(file) : result
    }
    return { calls, lookup }
}

test('SnowLuma self-sent echo (cache name, empty url) is resolved through get_image', async () => {
    const { calls, lookup } = recorder({ file: 'aef01498d1d788cd55cf456d8db932bc.png', url: httpUrl })
    const msg = [{ type: 'image', file: 'aef01498d1d788cd55cf456d8db932bc.png', url: '', summary: '[图片]' }]
    await resolveForwardImages(msg, lookup)
    assert.deepEqual(calls, ['aef01498d1d788cd55cf456d8db932bc.png'])
    assert.equal(msg[0].file, httpUrl)
    assert.equal(msg[0].url, httpUrl)
    assert.equal(msg[0].summary, '[图片]')
})

test('images that already carry a loadable source do not query the backend', async () => {
    const { calls, lookup } = recorder(undefined)
    const msg = [
        { type: 'image', file: 'aef.png', url: httpUrl },
        { type: 'image', file: 'base64://AAAA', url: '' },
        { type: 'image', file: 'file:///tmp/a.png' },
        { type: 'image', file: '/root/.config/QQ/a.png' },
        { type: 'image', file: 'C:\\QQ\\a.png' },
        { type: 'image', file: 'gif', url: 'data:image/gif;base64,AAAA' },
        { type: 'text', text: 'aef.png' },
    ]
    const before = JSON.stringify(msg)
    await resolveForwardImages(msg, lookup)
    assert.deepEqual(calls, [])
    assert.equal(JSON.stringify(msg), before)
})

test('nested OneBot segments and merged-forward node content are resolved', async () => {
    const { calls, lookup } = recorder({ url: httpUrl })
    const msg = [
        { type: 'image', data: { file: 'a.png', url: '' } },
        { type: 'node', content: [{ type: 'image', file: 'b.png' }] },
        { type: 'node', data: { content: [{ type: 'image', data: { file: 'c.png' } }] } },
    ]
    await resolveForwardImages(msg, lookup)
    assert.deepEqual(calls, ['a.png', 'b.png', 'c.png'])
    assert.equal(msg[0].data.file, httpUrl)
    assert.equal(msg[1].content[0].file, httpUrl)
    assert.equal(msg[2].data.content[0].data.file, httpUrl)
})

test('a local path returned by get_image (NapCat) is accepted when there is no URL', async () => {
    const { lookup } = recorder({ file: '/app/.config/QQ/NapCat/temp/a.png', url: '' })
    const msg = [{ type: 'image', file: 'a.png' }]
    await resolveForwardImages(msg, lookup)
    assert.equal(msg[0].file, '/app/.config/QQ/NapCat/temp/a.png')
})

test('an unresolvable picture fails with a readable error instead of sending a bare name', async () => {
    for (const result of [undefined, null, { file: 'a.png', url: '' }]) {
        const { lookup } = recorder(result)
        await assert.rejects(
            resolveForwardImages([{ type: 'image', file: 'a.png', url: '' }], lookup),
            /Image source unavailable: a\.png/,
        )
    }
    await assert.rejects(
        resolveForwardImages([{ type: 'image', url: '' }], recorder(undefined).lookup),
        /Image source unavailable: unknown/,
    )
})

test('lookup rejection propagates', async () => {
    await assert.rejects(
        resolveForwardImages([{ type: 'image', file: 'a.png' }], async () => { throw new Error('timeout') }),
        /timeout/,
    )
})

test('non-array payloads (CQ strings) are returned untouched', async () => {
    const { calls, lookup } = recorder(undefined)
    assert.equal(await resolveForwardImages('[CQ:image,file=a.png]', lookup), '[CQ:image,file=a.png]')
    assert.deepEqual(calls, [])
})

test('isLoadableImageSource', () => {
    for (const ok of [httpUrl, 'http://x/a.png', 'base64://AA', 'file:///a', '/a/b.png', 'D:/a.png', 'data:image/png;base64,AA']) {
        assert.ok(isLoadableImageSource(ok), ok)
    }
    for (const bad of ['', 'a.png', 'blob:http://x/1', 'relative/a.png', undefined, null, 1]) {
        assert.ok(!isLoadableImageSource(bad), String(bad))
    }
})

test('SnowLuma self-sent echo forwards the backend URL after the existing preparation', async () => {
    const { lookup } = recorder({ file: httpUrl, url: httpUrl })
    const echo = [{ type: 'image', data: { file: 'aef01498d1d788cd55cf456d8db932bc.png', url: '', sub_type: 0, summary: '[图片]' } }]
    const payload = prepareForwardMessage(await resolveForwardImages(echo, lookup))
    assert.deepEqual(payload, [{ type: 'image', file: httpUrl, url: httpUrl, sub_type: 0, summary: '[图片]' }])
})
