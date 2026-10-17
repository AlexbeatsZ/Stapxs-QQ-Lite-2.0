import assert from 'node:assert/strict'
import test from 'node:test'

import {
    FileDragTargets,
    getDroppedFiles,
    hasDraggedFiles,
    isInlineImageFile,
} from '../src/renderer/src/function/utils/fileDropUtil.ts'

function fileItem(file, isDirectory = false) {
    return {
        kind: 'file',
        getAsFile: () => file,
        webkitGetAsEntry: () => ({ isDirectory }),
    }
}

test('only reacts to drags that carry system files', () => {
    assert.equal(hasDraggedFiles({ types: ['Files'] }), true)
    assert.equal(hasDraggedFiles({ types: ['text/uri-list', 'Files'] }), true)
    assert.equal(hasDraggedFiles({ types: ['text/plain', 'text/html'] }), false)
    assert.equal(hasDraggedFiles({ types: [] }), false)
    assert.equal(hasDraggedFiles(null), false)
    assert.equal(hasDraggedFiles(undefined), false)
})

test('collects dropped files and skips folders and string items', () => {
    const report = new File(['data'], 'report 1+1.pdf', { type: 'application/pdf' })
    const photo = new File(['png'], 'photo.png', { type: 'image/png' })
    const folder = new File([], 'folder')
    const result = getDroppedFiles({
        items: [
            fileItem(report),
            { kind: 'string', getAsFile: () => null },
            fileItem(folder, true),
            fileItem(photo),
        ],
        files: [report, folder, photo],
    })
    assert.deepEqual(result.files, [report, photo])
    assert.equal(result.folders, 1)
})

test('falls back to the file list when items are unavailable', () => {
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' })
    assert.deepEqual(getDroppedFiles({ files: [file] }), { files: [file], folders: 0 })
    // 没有 webkitGetAsEntry 的环境不能把文件当成文件夹丢掉
    assert.deepEqual(
        getDroppedFiles({ items: [{ kind: 'file', getAsFile: () => file }] }),
        { files: [file], folders: 0 },
    )
    assert.deepEqual(getDroppedFiles(null), { files: [], folders: 0 })
})

test('sends only QQ-displayable images inline', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'IMAGE/PNG']) {
        assert.equal(isInlineImageFile({ type }), true, type)
    }
    for (const type of ['image/svg+xml', 'image/heic', 'image/tiff', 'application/pdf', '']) {
        assert.equal(isInlineImageFile({ type }), false, type)
    }
})

test('tracks whether a drag is still inside the page', () => {
    const targets = new FileDragTargets()
    const body = { isConnected: true }
    const input = { isConnected: true }
    targets.enter(body)
    // 进入子元素时，dragenter 先于父元素的 dragleave
    targets.enter(input)
    assert.equal(targets.leave(body), true)
    assert.equal(targets.leave(input), false)
})

test('ignores elements removed from the page during a drag', () => {
    const targets = new FileDragTargets()
    const message = { isConnected: true }
    const list = { isConnected: true }
    targets.enter(list)
    targets.enter(message)
    // 新消息重新渲染时，鼠标下的元素被移除，不会再收到 dragleave
    message.isConnected = false
    assert.equal(targets.leave(list), false)

    targets.enter(list)
    targets.clear()
    assert.equal(targets.leave(null), false)
})
