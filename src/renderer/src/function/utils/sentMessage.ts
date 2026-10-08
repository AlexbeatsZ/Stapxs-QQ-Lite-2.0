/** Update only the sent placeholder belonging to this delivered message. */
export function reconcileSentMessage(messages: any[], incoming: any): boolean {
    if (incoming?.message_id == null) return false
    const id = String(incoming.message_id)
    const pending = messages.find(item => item.fake_message_id != null &&
        String(item.message_id) === id &&
        String(item.sender?.user_id) === String(incoming.sender?.user_id) &&
        String(item.group_id ?? '') === String(incoming.group_id ?? ''))
    if (!pending) return false
    const stableId = pending.fake_message_id
    Object.assign(pending, incoming, { fake_message_id: stableId, fake_msg: undefined, revoke: false })
    // A self event can arrive before the send acknowledgement binds the UUID.
    for (let index = messages.length - 1; index >= 0; index--) {
        if (messages[index] !== pending && String(messages[index].message_id) === id) {
            messages.splice(index, 1)
        }
    }
    return true
}
