export type QuoteFailure = 'unavailable' | 'timeout'

export type QuoteEntry = {
    status: 'loading' | 'ready' | 'error'
    message?: any
    failure?: QuoteFailure
}

export class QuoteRequestError extends Error {
    failure: QuoteFailure

    constructor(failure: QuoteFailure) {
        super(failure)
        this.failure = failure
    }
}

export async function requestQuotedMessage(options: {
    id: string
    session: { id: string | number; type: string; selfId?: string | number }
    action: string
    call: (action: string, params: Record<string, unknown>, timeout: number) => Promise<any>
    normalize: (message: any) => Promise<any[]>
    isActive: () => boolean
}): Promise<any | null> {
    if (!options.isActive()) return null
    let response: any
    try {
        const numericId = Number(options.id)
        const messageId = /^-?\d+$/.test(options.id) && Number.isSafeInteger(numericId) ? numericId : options.id
        response = await options.call(options.action, { message_id: messageId }, 10000)
    } catch (error) {
        throw new QuoteRequestError(error instanceof Error && 'echo' in error ? 'timeout' : 'unavailable')
    }
    if (!options.isActive()) return null
    const raw = response?.data
    if (response?.status !== 'ok' || Number(response.retcode ?? 0) !== 0 ||
        !raw || String(raw.message_id) !== options.id || !raw.sender || !Number.isFinite(Number(raw.time))) {
        throw new QuoteRequestError('unavailable')
    }
    if (raw.message_type && raw.message_type !== (options.session.type === 'group' ? 'group' : 'private')) {
        throw new QuoteRequestError('unavailable')
    }
    if (options.session.type === 'group' && raw.group_id != null && String(raw.group_id) !== String(options.session.id)) {
        throw new QuoteRequestError('unavailable')
    }
    if (options.session.type !== 'group' && options.session.selfId != null) {
        const peers = [raw.user_id, raw.target_id, raw.sender.user_id]
            .filter(value => value != null && String(value) !== String(options.session.selfId))
        if (peers.some(value => String(value) !== String(options.session.id))) {
            throw new QuoteRequestError('unavailable')
        }
    }
    const messages = await options.normalize(raw)
    return options.isActive() ? messages[0] : null
}

type QuoteJob = {
    id: string
    generation: number
    resolve: (message: any | null) => void
    promise: Promise<any | null>
}

/** A bounded, session-scoped cache. It never inserts results into chat history. */
export class QuotedMessageLoader {
    readonly entries = new Map<string, QuoteEntry>()
    generation = 0
    private running = 0
    private queue: QuoteJob[] = []
    private pending = new Map<string, Promise<any | null>>()
    private recalledInFlight = new Set<string>()
    private request: (id: string, isActive: () => boolean) => Promise<any>
    private changed: () => void
    private limit: number

    constructor(
        request: (id: string, isActive: () => boolean) => Promise<any>,
        changed: () => void = () => {},
        limit = 128,
    ) {
        this.request = request
        this.changed = changed
        this.limit = limit
    }

    reset() {
        this.generation++
        this.entries.clear()
        this.pending.clear()
        this.recalledInFlight.clear()
        for (const job of this.queue.splice(0)) job.resolve(null)
        this.changed()
    }

    load(messageId: string | number, retry = false): Promise<any | null> {
        const id = String(messageId)
        if (!id || id === 'undefined' || id === 'null') return Promise.resolve(null)
        const pending = this.pending.get(id)
        if (pending) return pending
        const cached = this.entries.get(id)
        if (cached && (cached.status === 'ready' || !retry)) {
            // Refresh insertion order for LRU eviction.
            this.entries.delete(id)
            this.entries.set(id, cached)
            return Promise.resolve(cached.message ?? null)
        }
        let resolve!: QuoteJob['resolve']
        const promise = new Promise<any | null>(done => { resolve = done })
        this.pending.set(id, promise)
        this.entries.set(id, { status: 'loading' })
        this.queue.push({ id, generation: this.generation, resolve, promise })
        this.changed()
        this.drain()
        return promise
    }

    revoke(messageId: string | number) {
        const id = String(messageId)
        if (this.pending.has(id)) this.recalledInFlight.add(id)
        // Also remember recalls that arrive while the original request is in flight.
        this.entries.set(id, {
            status: 'ready',
            message: { message_id: id, revoke: true, message: [] },
        })
        this.trim()
        this.changed()
    }

    private trim() {
        for (const [id, entry] of this.entries) {
            if (this.entries.size <= this.limit) break
            if (entry.status !== 'loading') this.entries.delete(id)
        }
    }

    private drain() {
        while (this.running < 2 && this.queue.length > 0) {
            const job = this.queue.shift()!
            this.running++
            void this.run(job)
        }
    }

    private async run(job: QuoteJob) {
        const isActive = () => job.generation === this.generation
        let result: any | null = null
        try {
            // A queued request may have been recalled before it starts.
            if (this.recalledInFlight.has(job.id) || this.entries.get(job.id)?.message?.revoke) return
            const message = await this.request(job.id, isActive)
            if (!isActive()) return
            if (String(message?.message_id) !== job.id || !Array.isArray(message?.message)) {
                throw new QuoteRequestError('unavailable')
            }
            if (this.recalledInFlight.has(job.id) || this.entries.get(job.id)?.message?.revoke) return
            result = message
            this.entries.set(job.id, { status: 'ready', message })
        } catch (error) {
            if (isActive() && !this.recalledInFlight.has(job.id) && !this.entries.get(job.id)?.message?.revoke) {
                this.entries.set(job.id, {
                    status: 'error',
                    failure: error instanceof QuoteRequestError ? error.failure : 'unavailable',
                })
            }
        } finally {
            if (isActive()) {
                if (this.pending.get(job.id) === job.promise) this.pending.delete(job.id)
                this.recalledInFlight.delete(job.id)
                this.trim()
                this.changed()
            }
            job.resolve(result)
            this.running--
            this.drain()
        }
    }
}

/** Retain the existing compact media preview without rendering heavy attachments. */
export function quotePreviewMessage(message: any): any | null {
    if (!message || message.revoke) return null
    const fallbackTypes = new Set(['video', 'record', 'file', 'json', 'xml', 'forward'])
    if (message.message.some((segment: any) => fallbackTypes.has(segment.type))) return null
    let hasImage = false
    return {
        ...message,
        message: message.message.filter((segment: any) => {
            if (segment.type === 'reply') return false
            if (segment.type !== 'image' && segment.type !== 'mface') return true
            if (hasImage) return false
            hasImage = true
            return true
        }),
    }
}
