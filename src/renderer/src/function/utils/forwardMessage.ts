/** Capture a selection in chronological order before the destination is opened. */
export function snapshotForwardMessages(messages: any[], selectedIds: Array<string | number>): any[] {
    const ids = new Set(selectedIds.map(String))
    const selected = messages.filter(item => ids.has(String(item.message_id)))
    selected.sort((a, b) => {
        const timeA = Number(a.time), timeB = Number(b.time)
        if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) return timeA - timeB
        const seqA = Number(a.message_seq ?? a.seq_id ?? a.seq)
        const seqB = Number(b.message_seq ?? b.seq_id ?? b.seq)
        return Number.isFinite(seqA) && Number.isFinite(seqB) ? seqA - seqB : 0
    })
    // JSON also handles Vue proxies nested inside a message.
    return JSON.parse(JSON.stringify(selected))
}

function transferableImageSource(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length === 0) return undefined
    if (/^data:image\/[^;]+;base64,/i.test(value)) return 'base64://' + value.slice(value.indexOf(',') + 1)
    if (/^(https?:\/\/|base64:\/\/|file:\/\/)/i.test(value) ||
        /^(\/|[a-z]:[\\/])/i.test(value)) return value
    return undefined
}

/** Convert receive-only image URLs into OneBot's outgoing file parameter. */
export function prepareForwardMessage(message: any[]): any[] {
    return message.map(segment => {
        const item = JSON.parse(JSON.stringify(segment))
        if (item.data && typeof item.data === 'object' && !Array.isArray(item.data)) {
            const { type, data, ...fields } = item
            Object.assign(item, data, fields, { type })
            delete item.data
        }
        if (item.type === 'image') {
            item.file = transferableImageSource(item.file) ?? transferableImageSource(item.url) ?? item.file
            if (typeof item.file !== 'string' || !item.file || item.file.startsWith('blob:')) {
                throw new Error('Image has no transferable source')
            }
            if (item.type_item !== undefined) {
                item._type = item.type_item
                delete item.type_item
            }
        }
        if (Array.isArray(item.content)) item.content = prepareForwardMessage(item.content)
        return item
    })
}
