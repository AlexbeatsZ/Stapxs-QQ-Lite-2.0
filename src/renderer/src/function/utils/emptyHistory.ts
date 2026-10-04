/** Keep empty history records as pagination slots, even though they have no body. */
export function isEmptyHistoryPage(messages: any[]): boolean {
    return messages.length > 0 && messages.every(message =>
        Array.isArray(message?.message) && message.message.length === 0,
    )
}

/** Full-page adapters count recalled records too. Look past an empty first window. */
export async function expandEmptyHistoryPage(
    initial: any[],
    loadMore: (count: number) => Promise<any[] | undefined>,
    isActive: () => boolean,
): Promise<any[] | undefined> {
    let messages = initial
    // Bound automatic requests. Remaining placeholders still allow manual paging.
    for (let page = 0; page < 10 && isEmptyHistoryPage(messages); page++) {
        if (!isActive()) return undefined
        const older = await loadMore(messages.length + 20)
        if (!isActive()) return undefined
        // A capped/repeated window or exhausted backend must not create a loop.
        if (!older || older.length <= messages.length) break
        messages = older
    }
    return isActive() ? messages : undefined
}
