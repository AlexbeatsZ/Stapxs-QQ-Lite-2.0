export interface ForwardImageInfo {
    url?: unknown
    file?: unknown
}

export type ForwardImageLookup = (file: string) => Promise<ForwardImageInfo | null | undefined>

/** Whether the backend can load an outgoing image `file` without its own cache. */
export function isLoadableImageSource(value: unknown): value is string {
    return typeof value === 'string' && (
        /^(https?:\/\/|file:\/\/|base64:\/\/|data:image\/)/i.test(value) ||
        /^(\/|[a-z]:[\\/])/i.test(value)
    )
}

/**
 * Self-sent pictures can come back with only a cache name such as `<md5>.png`
 * and an empty URL. Sending that name again makes the backend stat a local file
 * (ENOENT), so ask the backend for the cached picture's real source first.
 */
export async function resolveForwardImages<T>(message: T, lookup: ForwardImageLookup): Promise<T> {
    if (!Array.isArray(message)) return message
    for (const segment of message) {
        if (!segment || typeof segment !== 'object') continue
        const fields = segment.data && typeof segment.data === 'object' && !Array.isArray(segment.data)? segment.data: segment
        if (segment.type === 'image' && !isLoadableImageSource(fields.url) && !isLoadableImageSource(fields.file)) {
            const file = typeof fields.file === 'string' ? fields.file : ''
            const info = file ? await lookup(file) : undefined
            const source = [info?.url, info?.file].find(isLoadableImageSource)
            if (!source) throw new Error('Image source unavailable: ' + (file || 'unknown'))
            fields.file = source
            fields.url = source
        }
        if (Array.isArray(fields.content)) await resolveForwardImages(fields.content, lookup)
    }
    return message
}
